from datetime import datetime
from typing import Any

from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class JobState(Base):
    """Last run info of periodic worker jobs (survives restarts, keeps us within supplier rate limits)."""

    __tablename__ = "job_state"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    last_started_at: Mapped[datetime | None]
    last_finished_at: Mapped[datetime | None]
    last_success_at: Mapped[datetime | None]
    last_error: Mapped[str | None] = mapped_column(Text)
    info: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class SiteSetting(Base):
    """Runtime settings edited from the admin panel (markups, contacts, ...)."""

    __tablename__ = "site_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
