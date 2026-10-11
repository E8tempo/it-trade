from decimal import Decimal
from typing import Annotated

from fastapi import Depends
from pydantic import BaseModel, PlainSerializer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_session
from app.models import User

Session = Annotated[AsyncSession, Depends(get_session)]
Admin = Annotated[User, Depends(require_admin)]
# amounts in responses: exact Decimal inside, a JSON number for the admin UI
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    per_page: int


def like(q: str) -> str:
    """LIKE pattern for a user's search string (wildcards escaped with backslash)."""
    q = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{q}%"
