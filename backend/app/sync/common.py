import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession

_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya",
})


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
