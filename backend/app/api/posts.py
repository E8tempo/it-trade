"""News and promotions for the site's home page (written in the admin panel: api/admin/posts.py)."""

from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import or_, select

from app.api.deps import Session
from app.models import Post, PostKind

router = APIRouter(prefix="/api", tags=["posts"])

SHOP_TZ = ZoneInfo("Europe/Simferopol")  # a promotion ends at the end of its last day there


class PostOut(BaseModel):
    id: int
    kind: PostKind
    title: str
    body: str
    link_url: str | None
    published_at: datetime | None
    pinned: bool
    ends_on: date | None

    @classmethod
    def of(cls, p: Post) -> "PostOut":
        return cls(
            id=p.id, kind=p.kind, title=p.title, body=p.body, link_url=p.link_url, published_at=p.published_at, pinned=p.pinned, ends_on=p.ends_on
        )


@router.get("/posts", response_model=list[PostOut])
async def posts(session: Session, kind: PostKind | None = None, limit: Annotated[int, Query(ge=1, le=50)] = 10):
    """Published news and current promotions: pinned first, then the newest."""
    today = datetime.now(SHOP_TZ).date()
    stmt = select(Post).where(Post.is_published, or_(Post.ends_on.is_(None), Post.ends_on >= today))
    if kind:
        stmt = stmt.where(Post.kind == kind)
    rows = await session.scalars(stmt.order_by(Post.pinned.desc(), Post.published_at.desc(), Post.id.desc()).limit(limit))
    return [PostOut.of(p) for p in rows]
