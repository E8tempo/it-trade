from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class PostKind(StrEnum):
    news = "news"
    promo = "promo"  # a promotion: shown until `ends_on`


class Post(TimestampMixin, Base):
    """News and promotions written in the admin panel, shown on the site's home page."""

    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[PostKind] = mapped_column(String(16), default=PostKind.news)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, default="")  # plain text, paragraphs split by blank lines
    link_url: Mapped[str | None] = mapped_column(String(512))  # «Подробнее»: a page of the site or another site
    is_published: Mapped[bool] = mapped_column(default=False, index=True)
    published_at: Mapped[datetime | None]  # set on the first publication; the order on the site
    pinned: Mapped[bool] = mapped_column(default=False)  # shown first
    ends_on: Mapped[date | None]  # a promotion's last day; hidden after it
