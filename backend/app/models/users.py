from datetime import datetime
from enum import StrEnum

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, utcnow


class UserRole(StrEnum):
    customer = "customer"
    admin = "admin"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # stored lower-cased
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[UserRole] = mapped_column(String(16), default=UserRole.customer)
    is_active: Mapped[bool] = mapped_column(default=True)
    last_login_at: Mapped[datetime | None]


class RefreshToken(Base):
    """Issued refresh tokens (by JWT id). Every refresh revokes the used token and issues a new one
    in the same family; presenting a revoked token again revokes the whole family (token theft),
    except within a short grace period after rotation (parallel requests refreshing at once)."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # jti
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    replaced_by: Mapped[str | None] = mapped_column(String(32))  # successor jti if revoked by rotation
    user_agent: Mapped[str | None] = mapped_column(String(255))


class EmailCode(Base):
    """A one-time code sent to an e-mail address (6 digits; only its hash is stored): proves the address belongs to
    whoever registers with it, before the account is created. The latest code of an address and purpose counts;
    it lasts a quarter of an hour and allows a few attempts (app/api/auth.py)."""

    __tablename__ = "email_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), index=True)  # lower-cased
    purpose: Mapped[str] = mapped_column(String(16))  # "signup"
    code_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    attempts: Mapped[int] = mapped_column(default=0)
    used_at: Mapped[datetime | None]
