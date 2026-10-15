"""Registration, login and JWT sessions.

Tokens are returned in the JSON body and also set as httpOnly cookies, so the browser
(same origin via Caddy in prod / Next.js rewrites in dev) needs no token handling at all:
  access_token  - lifetime of the access token
  refresh_token - lifetime of the refresh token (the Next.js proxy uses it to refresh
                  expired sessions before rendering a page)
API clients can instead send `Authorization: Bearer <access>` and pass the refresh token
in the body of /api/auth/refresh.
"""

import time
from collections import defaultdict, deque
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.account import OrganizationIn, check_not_registered, create_organization, is_registered
from app.api.deps import ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH, CurrentUser, Session, client_ip
from app.auth import (
    AuthError,
    TokenPair,
    hash_password,
    issue_tokens,
    normalize_email,
    revoke_all,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)
from app.companies import LookupUnavailable, configured, find_company
from app.config import get_settings
from app.models import User
from app.models.base import utcnow

router = APIRouter(prefix="/api/auth", tags=["auth"])


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None
    phone: str | None
    role: str

    @classmethod
    def of(cls, u: User) -> "UserOut":
        return cls(id=u.id, email=u.email, name=u.name, phone=u.phone, role=u.role)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class RegisterIn(BaseModel):
    """A client registers with their organization (the site sells to businesses only); they become its head."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=32)
    organization: OrganizationIn


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class PasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=32)


# --- brute-force protection (per API process) -----------------------------------------------

MAX_FAILURES, WINDOW = 10, 15 * 60
_failures: defaultdict[str, deque[float]] = defaultdict(deque)


def _check_throttle(*keys: str) -> None:
    now = time.monotonic()
    for key in keys:
        q = _failures[key]
        while q and now - q[0] > WINDOW:
            q.popleft()
        if len(q) >= MAX_FAILURES:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try again later")


def _record_failure(*keys: str) -> None:
    now = time.monotonic()
    for key in keys:
        _failures[key].append(now)


# --- helpers --------------------------------------------------------------------------------


def _respond(response: Response, user: User, pair: TokenPair) -> TokenOut:
    secure = get_settings().secure_cookies
    response.set_cookie(ACCESS_COOKIE, pair.access_token, max_age=pair.access_expires_in, httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie(
        REFRESH_COOKIE, pair.refresh_token, max_age=pair.refresh_expires_in, httponly=True, secure=secure, samesite="lax", path=REFRESH_COOKIE_PATH
    )
    response.headers["Cache-Control"] = "no-store"
    return TokenOut(access_token=pair.access_token, refresh_token=pair.refresh_token, expires_in=pair.access_expires_in, user=UserOut.of(user))


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)


# --- endpoints ------------------------------------------------------------------------------


@router.get("/company")
async def company(inn: Annotated[str, Query(pattern=r"^\d{10}(\d{2})?$")], request: Request, session: Session) -> dict:
    """The registration form's lookup of a company by ИНН. `configured`: false without a DaData key (the form asks
    for the requisites by hand, as it does when the lookup fails); `registered`: the company is a client already."""
    # open to guests: limited per address, like failed logins
    key = f"company:{client_ip(request)}"
    _check_throttle(key)
    _record_failure(key)  # every lookup counts: MAX_FAILURES per WINDOW
    registered = await is_registered(session, inn)
    try:
        found = await find_company(inn)
    except LookupUnavailable:
        return {"configured": configured(), "available": False, "company": None, "registered": registered}
    if found and found.kpp:
        registered = await is_registered(session, inn, found.kpp)
    return {"configured": True, "available": True, "company": found.as_dict() if found else None, "registered": registered}


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, request: Request, response: Response, session: Session):
    _check_throttle(f"ip:{client_ip(request)}")
    await check_not_registered(session, body.organization.inn, body.organization.kpp)
    user = User(email=normalize_email(body.email), password_hash=hash_password(body.password), name=body.name, phone=body.phone)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        _record_failure(f"ip:{client_ip(request)}")
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered") from None
    await create_organization(session, user, body.organization)
    pair = await issue_tokens(session, user, user_agent=request.headers.get("user-agent"))
    user.last_login_at = utcnow()
    await session.commit()
    return _respond(response, user, pair)


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, response: Response, session: Session):
    email = normalize_email(body.email)
    keys = (f"ip:{client_ip(request)}", f"email:{email}")
    _check_throttle(*keys)
    user = await session.scalar(select(User).where(User.email == email))
    if not verify_password(user, body.password) or not user.is_active:
        _record_failure(*keys)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    pair = await issue_tokens(session, user, user_agent=request.headers.get("user-agent"))
    user.last_login_at = utcnow()
    await session.commit()
    return _respond(response, user, pair)


@router.post("/refresh", response_model=TokenOut)
async def refresh(request: Request, response: Response, session: Session, body: Annotated[RefreshIn | None, Body()] = None):
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")
    try:
        user, pair = await rotate_refresh_token(session, token, request.headers.get("user-agent"))
    except AuthError:
        expired = JSONResponse({"detail": "Session expired, please log in again"}, status.HTTP_401_UNAUTHORIZED)
        _clear_cookies(expired)
        return expired
    await session.commit()
    return _respond(response, user, pair)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, session: Session, body: Annotated[RefreshIn | None, Body()] = None):
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if token:
        await revoke_refresh_token(session, token)
        await session.commit()
    _clear_cookies(response)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(user: CurrentUser, response: Response, session: Session):
    await revoke_all(session, user.id)
    await session.commit()
    _clear_cookies(response)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return UserOut.of(user)


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfileIn, user: CurrentUser, session: Session):
    for field in body.model_fields_set:
        setattr(user, field, getattr(body, field))
    await session.commit()
    return UserOut.of(user)


@router.post("/password", response_model=TokenOut)
async def change_password(body: PasswordIn, user: CurrentUser, request: Request, response: Response, session: Session):
    """Changes the password and ends all other sessions."""
    if not verify_password(user, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    await revoke_all(session, user.id)
    pair = await issue_tokens(session, user, user_agent=request.headers.get("user-agent"))
    await session.commit()
    return _respond(response, user, pair)
