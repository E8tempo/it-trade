"""Registration, login and JWT sessions.

Tokens are returned in the JSON body and also set as httpOnly cookies, so the browser
(same origin via Caddy in prod / Next.js rewrites in dev) needs no token handling at all:
  access_token  - lifetime of the access token
  refresh_token - lifetime of the refresh token (the Next.js proxy uses it to refresh
                  expired sessions before rendering a page)
API clients can instead send `Authorization: Bearer <access>` and pass the refresh token
in the body of /api/auth/refresh.
"""

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.api.account import OrganizationIn, check_not_registered, create_organization, is_registered
from app.api.deps import ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH, CurrentUser, Session, client_ip
from app.auth import (
    AuthError,
    TokenPair,
    hash_password,
    issue_tokens,
    normalize_email,
    refresh_family,
    revoke_all,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)
from app.companies import LookupUnavailable, configured, find_company
from app.config import get_settings
from app.mail import MailError, send_mail
from app.models import EmailCode, User
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
    """A client registers with their organization (the site sells to businesses only); they become its head.
    `code`: the one sent to the e-mail (POST /register/code): nobody takes an address that is not theirs."""

    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=32)
    organization: OrganizationIn


class SignupCodeIn(BaseModel):
    email: EmailStr


class SignupCodeOut(BaseModel):
    email: str
    resend_in: int  # seconds until another code can be asked for
    expires_in: int


class ResetCheckIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


class ResetIn(ResetCheckIn):
    new_password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class PasswordIn(BaseModel):
    """A new password from the account: confirmed with a code sent to the user's e-mail (POST /password/code),
    not with the current password, so a forgotten one is no obstacle and an open session alone is not enough."""

    code: str = Field(pattern=r"^\d{6}$")
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


# --- e-mail codes ---------------------------------------------------------------------------

CODE_TTL = timedelta(minutes=15)
CODE_RESEND = timedelta(seconds=60)
CODE_ATTEMPTS = 5  # wrong tries of one code; then a new one is needed
CODES_PER_HOUR = 5  # per address: nobody's mailbox gets flooded with codes...
CODES_PER_DAY = 10  # ...and a day's tries are few: guessing a code out of a million would take years
FAILS_PER_DAY = 15  # wrong codes of an address and purpose, over all its codes of the last day
CODES_KEPT = timedelta(days=2)  # older codes are deleted (the daily limits look one day back)
SIGNUP, RESET = "signup", "reset"


def _code_hash(email: str, code: str) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


async def _latest_code(session, email: str, purpose: str) -> EmailCode | None:
    return await session.scalar(
        select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose).order_by(EmailCode.id.desc()).limit(1)
    )


async def _use_code(session, email: str, purpose: str, code: str, consume: bool = True) -> None:
    """Accepts the latest code sent to the address (used up unless `consume` is false), or 400 saying what to do."""
    day = utcnow() - timedelta(days=1)
    fails = await session.scalar(
        select(func.coalesce(func.sum(EmailCode.attempts), 0)).where(
            EmailCode.email == email, EmailCode.purpose == purpose, EmailCode.created_at > day
        )
    )
    if fails >= FAILS_PER_DAY:
        raise HTTPException(429, "Слишком много неверных кодов для этого адреса. Попробуйте завтра.")
    row = await _latest_code(session, email, purpose)
    if row is None or row.used_at is not None or row.expires_at <= utcnow():
        raise HTTPException(400, "Код устарел. Запросите новый.")
    if row.attempts >= CODE_ATTEMPTS:
        raise HTTPException(400, "Слишком много неверных попыток. Запросите новый код.")
    if not hmac.compare_digest(row.code_hash, _code_hash(email, code)):
        row.attempts += 1
        await session.commit()
        left = CODE_ATTEMPTS - row.attempts
        raise HTTPException(400, f"Неверный код. Осталось попыток: {left}." if left else "Неверный код. Запросите новый.")
    if consume:
        row.used_at = utcnow()


# what the code is for, and what to do if the letter was not expected
LETTERS = {
    SIGNUP: ("Ваш код для регистрации на сайте IT Trade:", "Если вы не регистрировались, просто удалите это письмо."),
    RESET: (
        "Ваш код для восстановления пароля на сайте IT Trade:",
        "Если вы не просили сменить пароль, просто удалите это письмо: пароль останется прежним.",
    ),
}


def _exists_letter() -> tuple[str, str, str]:
    """To an address that is registered already, instead of a sign-up code."""
    subject = "Вы уже зарегистрированы на IT Trade"
    lines = (
        "С этим адресом пытались зарегистрироваться на сайте IT Trade, но аккаунт с ним уже есть.",
        "Войдите на сайте. Если не помните пароль, нажмите «Забыли пароль?» на странице входа.",
        "Если это были не вы, просто удалите это письмо: с аккаунтом ничего не произошло.",
    )
    text = "Здравствуйте!\n\n" + "\n\n".join(lines) + "\n"
    html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><p>Здравствуйте!</p>' + "".join(f"<p>{x}</p>" for x in lines) + "</div>"
    return subject, text, html


def _code_letter(code: str, purpose: str) -> tuple[str, str, str]:
    what, ignore = LETTERS[purpose]
    minutes = int(CODE_TTL.total_seconds() // 60)
    subject = f"Код подтверждения: {code}"
    text = f"Здравствуйте!\n\n{what} {code}\n\nКод действует {minutes} минут. {ignore}\n"
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">'
        f"<p>Здравствуйте!</p><p>{what}</p>"
        f'<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{code}</p>'
        f"<p>Код действует {minutes} минут. {ignore}</p></div>"
    )
    return subject, text, html


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


@router.post("/register/code", response_model=SignupCodeOut)
async def signup_code(body: SignupCodeIn, request: Request, session: Session):
    """Sends a code to the address registering: the account is created with it only (POST /register).

    The answer is the same whether the address is registered or not, so the form does not tell whose addresses
    have accounts. A registered one gets a letter saying so instead of a code (a code is still recorded, never
    sent: nobody can register it again, and the pauses and limits are the same)."""
    _check_throttle(f"code:{client_ip(request)}")
    email = normalize_email(body.email)
    exists = await session.scalar(select(User.id).where(User.email == email)) is not None
    return await _send_code(session, request, email, SIGNUP, letter=_exists_letter() if exists else None)


@router.post("/password/code", response_model=SignupCodeOut)
async def reset_code(body: SignupCodeIn, request: Request, session: Session, tasks: BackgroundTasks):
    """«Забыли пароль?»: a code to the address, if it has an account. The answer is the same either way, so the
    form does not tell which addresses are registered: without an account a code is still recorded, never sent
    (the same pauses and limits), and the letter goes out after the answer (the same time to answer)."""
    _check_throttle(f"code:{client_ip(request)}")
    email = normalize_email(body.email)
    user = await session.scalar(select(User).where(User.email == email))
    deliver = user is not None and user.is_active
    return await _send_code(session, request, email, RESET, deliver=deliver, tasks=tasks)


@router.post("/password/check", status_code=status.HTTP_204_NO_CONTENT)
async def reset_check(body: ResetCheckIn, session: Session):
    """Tells the form whether the code is right before the new password is asked for; a wrong one counts as a
    try. The code stays valid for POST /password/reset."""
    await _use_code(session, normalize_email(body.email), RESET, body.code, consume=False)


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(body: ResetIn, session: Session):
    """A new password with the code sent to the address; all sessions end (the form signs in afterwards)."""
    email = normalize_email(body.email)
    await _use_code(session, email, RESET, body.code)
    user = await session.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        raise HTTPException(400, "Код устарел. Запросите новый.")
    user.password_hash = hash_password(body.new_password)
    await revoke_all(session, user.id)
    await session.commit()
    _failures.pop(f"email:{email}", None)  # failed logins before the reset do not lock the new password out


async def _send_code(
    session,
    request: Request,
    email: str,
    purpose: str,
    *,
    deliver: bool = True,
    letter: tuple[str, str, str] | None = None,
    tasks: BackgroundTasks | None = None,
) -> SignupCodeOut:
    """Records a new code for the address and mails it (or `letter` instead), within the pauses and limits.
    With `tasks` the letter goes out after the answer: a failure is only logged then."""
    key = f"code:{client_ip(request)}"
    now = utcnow()
    await session.execute(delete(EmailCode).where(EmailCode.created_at < now - CODES_KEPT))
    last = await _latest_code(session, email, purpose)
    if last is not None and now - last.created_at < CODE_RESEND:
        wait = int((CODE_RESEND - (now - last.created_at)).total_seconds()) + 1
        raise HTTPException(429, f"Новый код можно запросить через {wait} с", headers={"Retry-After": str(wait)})
    recent = await session.scalar(
        select(func.count()).select_from(EmailCode).where(EmailCode.email == email, EmailCode.created_at > now - timedelta(hours=1))
    )
    if recent >= CODES_PER_HOUR:
        raise HTTPException(429, "На этот адрес уже отправлено много кодов. Попробуйте через час.")
    today = await session.scalar(
        select(func.count()).select_from(EmailCode).where(EmailCode.email == email, EmailCode.created_at > now - timedelta(days=1))
    )
    if today >= CODES_PER_DAY:
        raise HTTPException(429, "На этот адрес сегодня отправлено слишком много кодов. Попробуйте завтра.")
    _record_failure(key)  # every code sent counts against the address it is asked from
    code = f"{secrets.randbelow(1_000_000):06d}"
    session.add(EmailCode(email=email, purpose=purpose, code_hash=_code_hash(email, code), expires_at=now + CODE_TTL))
    await session.flush()
    mail = letter or _code_letter(code, purpose)
    if deliver and tasks is not None:
        await session.commit()
        tasks.add_task(_send_later, email, mail)
        return SignupCodeOut(email=email, resend_in=int(CODE_RESEND.total_seconds()), expires_in=int(CODE_TTL.total_seconds()))
    try:
        if deliver:
            await send_mail(email, *mail)
    except MailError:
        await session.rollback()
        raise HTTPException(503, "Не удалось отправить письмо. Проверьте адрес или попробуйте позже.") from None
    await session.commit()
    return SignupCodeOut(email=email, resend_in=int(CODE_RESEND.total_seconds()), expires_in=int(CODE_TTL.total_seconds()))


async def _send_later(email: str, mail: tuple[str, str, str]) -> None:
    try:
        await send_mail(email, *mail)
    except MailError:
        pass  # logged by send_mail; the form cannot be told any more


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, request: Request, response: Response, session: Session):
    _check_throttle(f"ip:{client_ip(request)}")
    # every registration counts, not only the failed ones: no mass sign-ups from one address
    signups = f"register:{client_ip(request)}"
    _check_throttle(signups)
    _record_failure(signups)
    await check_not_registered(session, body.organization.inn, body.organization.kpp)
    # the code first: a registered address never got one, so it is refused like any wrong code and the answer
    # does not tell that the address has an account (the conflict below is a race of two sign-ups)
    await _use_code(session, normalize_email(body.email), SIGNUP, body.code)
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
    """Changes the password and ends all other sessions. This one goes on: its refresh token is rotated as on
    a refresh (the replaced one keeps its grace period), so a request of this browser that still carries the old
    cookie is not taken for a stolen token and does not sign it out."""
    await _use_code(session, user.email, RESET, body.code)
    user.password_hash = hash_password(body.new_password)
    token = request.cookies.get(REFRESH_COOKIE)
    family = refresh_family(token, user.id)
    await revoke_all(session, user.id, except_family=family)
    if family:
        try:
            _, pair = await rotate_refresh_token(session, token, request.headers.get("user-agent"))
        except AuthError:
            family = None
    if not family:  # a bearer-token client, or its session was over: a new one
        await revoke_all(session, user.id)
        pair = await issue_tokens(session, user, user_agent=request.headers.get("user-agent"))
    await session.commit()
    return _respond(response, user, pair)
