"""Passwords and JWT sessions.

* access token: short-lived (JWT_ACCESS_TTL_MIN), stateless, carries user id and role;
* refresh token: long-lived (JWT_REFRESH_TTL_DAYS), its id (jti) is stored in `refresh_tokens`.
  Every refresh revokes the presented token and issues a new pair in the same "family".
  If an already revoked token is presented again (it was stolen or replayed), the whole
  family is revoked and the user has to log in again. A token rotated less than
  REUSE_GRACE ago is still accepted: several requests of one page (prefetches, the
  Next.js proxy) may refresh with the same token concurrently.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import RefreshToken, User, UserRole
from app.models.base import utcnow

log = logging.getLogger(__name__)
ALGORITHM = "HS256"
ISSUER = "it-trade"
REUSE_GRACE = timedelta(seconds=30)
_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("timing-equaliser")


class AuthError(Exception):
    pass


# --- passwords ------------------------------------------------------------------------------


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(user: User | None, password: str) -> bool:
    """Constant-ish time: a dummy hash is checked when there is no such user."""
    try:
        return _hasher.verify(user.password_hash if user else _DUMMY_HASH, password) and user is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


def normalize_email(email: str) -> str:
    return email.strip().lower()


# --- tokens ---------------------------------------------------------------------------------


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    access_expires_in: int  # seconds
    refresh_expires_in: int
    refresh_jti: str


def _secret() -> str:
    return get_settings().jwt_secret.get_secret_value()


def _encode(claims: dict) -> str:
    return jwt.encode({**claims, "iss": ISSUER}, _secret(), algorithm=ALGORITHM)


def decode_token(token: str, expected_type: str) -> dict:
    try:
        claims = jwt.decode(
            token, _secret(), algorithms=[ALGORITHM], issuer=ISSUER, options={"require": ["exp", "iat", "sub", "type"]}
        )
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid token: {e}") from e
    if claims.get("type") != expected_type:
        raise AuthError("wrong token type")
    return claims


async def issue_tokens(session: AsyncSession, user: User, *, family: str | None = None, user_agent: str | None = None) -> TokenPair:
    s = get_settings()
    now = utcnow()
    access_ttl = timedelta(minutes=s.jwt_access_ttl_min)
    refresh_ttl = timedelta(days=s.jwt_refresh_ttl_days)
    jti, family = uuid.uuid4().hex, family or uuid.uuid4().hex
    access = _encode({"sub": str(user.id), "role": user.role, "type": "access", "iat": now, "exp": now + access_ttl})
    refresh = _encode({"sub": str(user.id), "type": "refresh", "jti": jti, "fam": family, "iat": now, "exp": now + refresh_ttl})
    session.add(RefreshToken(id=jti, user_id=user.id, family=family, expires_at=now + refresh_ttl, user_agent=(user_agent or "")[:255] or None))
    return TokenPair(access, refresh, int(access_ttl.total_seconds()), int(refresh_ttl.total_seconds()), jti)


async def rotate_refresh_token(session: AsyncSession, token: str, user_agent: str | None = None) -> tuple[User, TokenPair]:
    claims = decode_token(token, "refresh")
    row = await session.get(RefreshToken, claims.get("jti", ""))
    if row is None or row.user_id != int(claims["sub"]):
        raise AuthError("unknown refresh token")
    now = utcnow()
    if row.revoked_at is not None:
        in_grace = row.replaced_by is not None and now - row.revoked_at < REUSE_GRACE
        if not in_grace:
            await revoke_family(session, row.family)
            await session.commit()
            log.warning("refresh token reuse detected for user %s, family revoked", row.user_id)
            raise AuthError("refresh token reused")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise AuthError("user is disabled")
    pair = await issue_tokens(session, user, family=row.family, user_agent=user_agent)
    if row.revoked_at is None:
        row.revoked_at, row.replaced_by = now, pair.refresh_jti
    return user, pair


async def revoke_refresh_token(session: AsyncSession, token: str) -> None:
    try:
        claims = decode_token(token, "refresh")
    except AuthError:
        return
    await session.execute(
        update(RefreshToken).where(RefreshToken.id == claims.get("jti"), RefreshToken.revoked_at.is_(None)).values(revoked_at=utcnow())
    )


async def revoke_family(session: AsyncSession, family: str) -> None:
    await session.execute(update(RefreshToken).where(RefreshToken.family == family, RefreshToken.revoked_at.is_(None)).values(revoked_at=utcnow()))
    # no grace period for a compromised family
    await session.execute(update(RefreshToken).where(RefreshToken.family == family).values(replaced_by=None))


async def revoke_all(session: AsyncSession, user_id: int) -> None:
    await session.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=utcnow()))


# --- bootstrap ------------------------------------------------------------------------------


async def ensure_admin(session: AsyncSession) -> None:
    """Creates the ADMIN_EMAIL account on first start. An existing account is left as is
    (its password may have been changed since)."""
    s = get_settings()
    email, password = normalize_email(s.admin_email), s.admin_password.get_secret_value()
    if not email or not password:
        return
    if await session.scalar(select(User.id).where(User.email == email)):
        return
    session.add(User(email=email, password_hash=hash_password(password), role=UserRole.admin, name="Администратор"))
    try:
        await session.commit()
        log.info("admin account %s created", email)
    except IntegrityError:  # created concurrently by another API process
        await session.rollback()
