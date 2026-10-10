"""Category tree: /download/catalog/json/catalog_tree_N.json (updated nightly, limit 1/min)."""

import json
import logging
import tempfile
from pathlib import Path

from sqlalchemy import update

from app.db import SessionLocal
from app.models import Category
from app.models.base import utcnow
from app.supplier.client import SupplierClient
from app.sync.common import slugify, upsert

log = logging.getLogger(__name__)


def flatten_tree(nodes: list[dict]) -> list[dict]:
    rows: list[dict] = []

    def walk(items: list[dict], parent: int | None, path: str, depth: int):
        for pos, n in enumerate(items):
            cid = int(n["id"])
            p = f"{path}{cid}/"
            rows.append({
                "id": cid,
                "parent_id": parent,
                "name": n["name"].strip(),
                "slug": slugify(n["name"]),
                "depth": depth,
                "position": pos,
                "leaf": bool(n.get("leaf", not n.get("childrens"))),
                "path": p,
                "is_active": True,
            })
            walk(n.get("childrens") or [], cid, p, depth + 1)

    walk(nodes, None, "/", 0)
    return rows


async def import_tree_file(path: Path) -> dict:
    rows = flatten_tree(json.loads(path.read_text(encoding="utf-8")))
    now = utcnow()
    for r in rows:
        r["updated_at"] = now
    rows.sort(key=lambda r: r["depth"])  # parents first: the self-referencing FK must be satisfied
    async with SessionLocal() as session:
        cols = ["parent_id", "name", "slug", "depth", "position", "leaf", "path", "is_active", "updated_at"]
        await upsert(session, Category.__table__, rows, "id", cols)
        await session.execute(update(Category).where(Category.updated_at < now).values(is_active=False))
        await session.commit()
    log.info("categories: %d synced", len(rows))
    return {"categories": len(rows)}


async def sync_categories(client: SupplierClient) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        f = await client.download(f"/download/catalog/json/catalog_tree_{client.s.supplier_pricelist}.json", Path(tmp) / "tree.json")
        return await import_tree_file(f)
