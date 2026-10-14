from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthError, decode_token
from app.db import get_session
from app.models import User, UserRole

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
# "/" rather than "/api/auth": the Next.js proxy refreshes expired sessions on page requests
REFRESH_COOKIE_PATH = "/"

Session = Annotated[AsyncSession, Depends(get_session)]


def bearer_or_cookie(request: Request) -> str | None:
    """Access token from `Authorization: Bearer ...` or the httpOnly cookie set at login."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(ACCESS_COOKIE)


async def optional_user(request: Request, session: Session) -> User | None:
    token = bearer_or_cookie(request)
    if not token:
        return None
    try:
        claims = decode_token(token, "access")
    except AuthError:
        return None
    user = await session.get(User, int(claims["sub"]))
    return user if user and user.is_active else None


async def shop_user(request: Request, user: Annotated[User | None, Depends(optional_user)]) -> User | None:
    """optional_user for the storefront's own data (cart, checkout). A browser whose access token is gone or
    expired while it still has a refresh token gets 401: the client refreshes the session and repeats the
    request, instead of a signed-in customer being served as a guest (and adding to a guest cart)."""
    if user is None and request.cookies.get(REFRESH_COOKIE):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired", headers={"WWW-Authenticate": "Bearer"})
    return user


async def current_user(user: Annotated[User | None, Depends(optional_user)]) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return user


async def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


CurrentUser = Annotated[User, Depends(current_user)]
ShopUser = Annotated[User | None, Depends(shop_user)]
