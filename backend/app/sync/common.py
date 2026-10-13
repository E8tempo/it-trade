import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import JobState

_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya",
})


async def job_progress(name: str, phase: str, share: float | None, detail: str | None = None) -> None:
    """How far a running job is, for the admin panel: job_state.info until the job ends with its result.
    `share` is None when it is not known how much is left (`detail` then tells what is done)."""
    async with SessionLocal() as session:
        st = await session.get(JobState, name)
        if st is not None:
            share = None if share is None else round(min(1.0, max(0.0, share)), 3)
            st.info = {"phase": phase, "progress": share, "detail": detail}
            await session.commit()


def slugify(text: str, max_len: int = 120) -> str:
    s = text.lower().translate(_TRANSLIT)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len].rstrip("-") or "item"


async def upsert(session: AsyncSession, table: Table, rows: Sequence[dict[str, Any]], key: str, update: Sequence[str]) -> None:
    """INSERT ... ON CONFLICT (key) DO UPDATE for Postgres and SQLite."""
    if not rows:
        return
    dialect = session.bind.dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    # stay below the bind parameter limit (asyncpg: 32767, sqlite: 999 on older builds);
    # defaults (created_at...) add parameters too, hence all table columns
    chunk = max(1, (30000 if dialect == "postgresql" else 990) // len(table.columns))
    for i in range(0, len(rows), chunk):
        stmt = insert(table).values(list(rows[i : i + chunk]))
        stmt = stmt.on_conflict_do_update(index_elements=[key], set_={c: stmt.excluded[c] for c in update})
        await session.execute(stmt)
