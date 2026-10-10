"""Product catalog: /download/catalog/json/products_N.json (~390k items, ~125 MB, nightly, limit 2/hour)."""

import heapq
import logging
import tempfile
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

import ijson
from sqlalchemy import select, update

from app.config import get_settings
from app.db import SessionLocal
from app.models import Category, Product
from app.models.base import utcnow
from app.supplier.client import SupplierClient
from app.sync.common import slugify, upsert

log = logging.getLogger(__name__)
BATCH = 2000

UPDATE_COLS = [
    "category_id", "name", "slug", "part", "vendor", "description", "barcodes", "weight", "volume",
    "warranty_months", "rrp", "multiplicity", "has_image", "is_active", "catalog_seen_at", "search_text", "updated_at",
]


def _num(v) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _money(v) -> Decimal | None:
    try:
        return Decimal(str(v)).quantize(Decimal("0.01")) if v not in (None, "", 0) else None
    except InvalidOperation:
        return None


def _int(v) -> int | None:
    try:
        return int(str(v).strip()) if v not in (None, "") else None
    except ValueError:
        return None


def _str(v, limit: int) -> str | None:
    s = str(v).strip() if v is not None else ""
    return s[:limit] or None


def product_row(p: dict, categories: set[int], now) -> dict | None:
    sku = _int(p.get("sku"))
    name = _str(p.get("name"), 1024)
    if not sku or not name:
        return None
    cat = _int(p.get("category"))
    part, vendor = _str(p.get("part"), 255), _str(p.get("vendor"), 255)
    return {
        "sku": sku,
        "category_id": cat if cat in categories else None,
        "name": name,
        "slug": slugify(name),
        "part": part,
        "vendor": vendor,
        "description": _str(p.get("description"), 20000),
        "barcodes": _str(p.get("barcodes"), 1024),
        "weight": _num(p.get("weight")),
        "volume": _num(p.get("volume")),
        "warranty_months": _int(p.get("warranty")),
        "rrp": _money(p.get("rrp")),
        "multiplicity": max(1, _int(p.get("multiplicity")) or 1),
        "has_image": bool(p.get("has_image")),
        "is_active": True,
        "catalog_seen_at": now,
        "search_text": " ".join(x for x in (name, part, vendor, str(sku)) if x).lower(),
        "updated_at": now,
    }


async def import_products_file(path: Path, sample_per_category: int = 0, prefer: set[int] | None = None) -> dict:
    """Upserts the supplier catalog; products missing from it are deactivated.

    With `sample_per_category` > 0 (development) only up to N products with photos per category
    are kept: the ones in `prefer` (in stock) first, then the newest.
    """
    now = utcnow()
    async with SessionLocal() as session:
        categories = set((await session.scalars(select(Category.id))).all())
    prefer = prefer or set()
    total = 0
    batch: list[dict] = []
    seen: set[int] = set()
    sample: defaultdict[int, list[tuple[tuple[bool, int], dict]]] = defaultdict(list)
    with path.open("rb") as f:
        for item in ijson.items(f, "item", use_float=True):
            row = product_row(item, categories, now)
            if row is None or row["sku"] in seen:
                continue
            seen.add(row["sku"])
            if sample_per_category:
                if row["has_image"] and row["category_id"] is not None:
                    heap = sample[row["category_id"]]
                    entry = ((row["sku"] in prefer, row["sku"]), row)
                    if len(heap) < sample_per_category:
                        heapq.heappush(heap, entry)
                    elif entry[0] > heap[0][0]:
                        heapq.heapreplace(heap, entry)
                continue
            batch.append(row)
            if len(batch) >= BATCH:
                total += await _flush(batch)
                batch = []
    if sample_per_category:
        batch = [row for heap in sample.values() for _, row in heap]
        for i in range(0, len(batch), BATCH):
            total += await _flush(batch[i : i + BATCH])
    else:
        total += await _flush(batch)
    async with SessionLocal() as session:
        res = await session.execute(
            update(Product)
            .where(Product.is_active, (Product.catalog_seen_at < now) | Product.catalog_seen_at.is_(None))
            .values(is_active=False, in_stock=False)
        )
        await session.commit()
    log.info("products: %d upserted, %d deactivated%s", total, res.rowcount, f" (sample {sample_per_category}/category)" if sample_per_category else "")
    return {"products": total, "deactivated": res.rowcount}


async def _flush(batch: list[dict]) -> int:
    if not batch:
        return 0
    async with SessionLocal() as session:
        await upsert(session, Product.__table__, batch, "sku", UPDATE_COLS)
        await session.commit()
    return len(batch)


async def sync_products(client: SupplierClient) -> dict:
    n = get_settings().catalog_sample_per_category
    # the dev sample prefers in-stock products (one extra get_active_products call, limit 10/hour)
    prefer = {it["sku"] for it in await client.get_active_products()} if n and client.has_credentials else None
    with tempfile.TemporaryDirectory() as tmp:
        f = await client.download(f"/download/catalog/json/products_{client.s.supplier_pricelist}.json", Path(tmp) / "products.json")
        return await import_products_file(f, n, prefer)
