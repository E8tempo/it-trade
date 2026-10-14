"""News and promotions: written here, shown on the site's home page once published."""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.api.admin.common import Session
from app.api.posts import PostOut
from app.models import Post, PostKind
from app.models.base import utcnow

router = APIRouter()


class AdminPost(PostOut):
    is_published: bool


class PostIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    kind: PostKind = PostKind.news
    title: str = Field(min_length=1, max_length=255)
    body: str = Field("", max_length=20_000)
    link_url: str | None = Field(None, max_length=512, description="A page of the site (/catalog/...) or https://...")
    is_published: bool = False
    pinned: bool = False
    ends_on: date | None = None

    @field_validator("link_url", mode="before")
    @classmethod
    def _link(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return None
            if not (v.startswith("/") and not v.startswith("//")) and not v.startswith(("https://", "http://")):
                raise ValueError("Ссылка — страница сайта (/catalog/...) или адрес https://...")
        return v


def _admin(p: Post) -> AdminPost:
    return AdminPost(**PostOut.of(p).model_dump(), is_published=p.is_published)


async def _get(session: Session, post_id: int) -> Post:
    p = await session.get(Post, post_id)
    if p is None:
        raise HTTPException(404, "Запись не найдена")
    return p


def _apply(p: Post, body: PostIn) -> None:
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    if p.is_published and p.published_at is None:  # the date of the first publication orders the home page
        p.published_at = utcnow()


@router.get("/posts", response_model=list[AdminPost])
async def list_posts(session: Session):
    """Drafts first, then the published ones, newest first."""
    rows = await session.scalars(select(Post).order_by(Post.is_published, Post.published_at.desc(), Post.id.desc()))
    return [_admin(p) for p in rows]


@router.post("/posts", response_model=AdminPost, status_code=status.HTTP_201_CREATED)
async def create_post(body: PostIn, session: Session):
    p = Post()
    _apply(p, body)
    session.add(p)
    await session.commit()
    return _admin(p)


@router.put("/posts/{post_id}", response_model=AdminPost)
async def edit_post(post_id: int, body: PostIn, session: Session):
    p = await _get(session, post_id)
    _apply(p, body)
    await session.commit()
    return _admin(p)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(post_id: int, session: Session):
    await session.delete(await _get(session, post_id))
    await session.commit()
