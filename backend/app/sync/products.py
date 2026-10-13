"""Product catalog: /download/catalog/json/products_N.json (~390k items, ~125 MB, nightly, limit 2/hour)."""

import heapq
import logging
import tempfile
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from decimal import Decimal, InvalidOperation
from pathlib import Path

import ijson
from sqlalchemy import select, update

from app.config import get_settings
from app.db import SessionLocal
from app.models import Category, Product
from app.models.base import utcnow
from app.supplier.client import SupplierClient
from app.sync.common import job_progress, slugify, upsert

log = logging.getLogger(__name__)
BATCH = 2000
PROGRESS_EVERY = 20000  # products read between progress reports

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


SampleEntry = tuple[tuple[bool, int], dict]


def spread_sample(sample: dict[int, list[SampleEntry]], root_of: dict[int, int], limit: int) -> list[dict]:
    """Up to `limit` rows spread over the whole catalog: the root categories take turns, each going
    through its categories (the best product of every category first, then the second ones...).
    Entries are ((in_stock, sku), row): in-stock products and categories that have them go first."""
    queues: dict[int, deque[list[SampleEntry]]] = {}
    for cat_id, heap in sample.items():
        entries = sorted(heap, key=lambda e: e[0], reverse=True)
        if entries:
            queues.setdefault(root_of.get(cat_id, cat_id), deque()).append(entries)
    for root, q in queues.items():
        queues[root] = deque(sorted(q, key=lambda entries: entries[0][0], reverse=True))
    picked: list[dict] = []
    roots = sorted(queues)
    while roots and len(picked) < limit:
        for root in list(roots):
            q = queues[root]
            entries = q.popleft()
            picked.append(entries.pop(0)[1])
            if entries:
                q.append(entries)
            if not q:
                roots.remove(root)
            if len(picked) >= limit:
                break
    return picked


async def import_products_file(
    path: Path,
    sample_per_category: int = 0,
    prefer: set[int] | None = None,
    sample_limit: int = 0,
    progress: Callable[[float], Awaitable[None]] | None = None,
) -> dict:
    """Upserts the supplier catalog; products missing from it are deactivated.

    Development samples (only products with photos; the ones in `prefer`, i.e. in stock, first):
      * `sample_per_category` > 0: up to N products per category;
      * `sample_limit` > 0: at most this many products in total, spread over the root categories.
    """
    now = utcnow()
    async with SessionLocal() as session:
        paths = dict((await session.execute(select(Category.id, Category.path))).all())
    categories = set(paths)
    root_of = {cid: int(p.strip("/").split("/")[0]) for cid, p in paths.items()}
    if sample_limit and not sample_per_category:
        sample_per_category = 3  # enough depth for categories that are picked more than once
    prefer = prefer or set()
    total = 0
    batch: list[dict] = []
    seen: set[int] = set()
    sample: defaultdict[int, list[tuple[tuple[bool, int], dict]]] = defaultdict(list)
    size = path.stat().st_size or 1
    with path.open("rb") as f:
        for k, item in enumerate(ijson.items(f, "item", use_float=True), 1):
            if progress and k % PROGRESS_EVERY == 0:
                await progress(f.tell() / size)  # ijson reads ahead in small chunks: close enough
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
        if sample_limit:
            batch = spread_sample(sample, root_of, sample_limit)
        else:
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
    sample_info = f" (dev sample: {sample_per_category}/category, limit {sample_limit or '-'})" if sample_per_category else ""
    log.info("products: %d upserted, %d deactivated%s", total, res.rowcount, sample_info)
    return {"products": total, "deactivated": res.rowcount}


async def _flush(batch: list[dict]) -> int:
    if not batch:
        return 0
    async with SessionLocal() as session:
        await upsert(session, Product.__table__, batch, "sku", UPDATE_COLS)
        await session.commit()
    return len(batch)


async def sync_products(client: SupplierClient) -> dict:
    s = get_settings()
    n, limit = s.catalog_sample_per_category, s.catalog_sample_limit
    # a dev sample prefers in-stock products (one extra get_active_products call, limit 10/hour)
    prefer = {it["sku"] for it in await client.get_active_products()} if (n or limit) and client.has_credentials else None
    with tempfile.TemporaryDirectory() as tmp:
        f = await client.download(
            f"/download/catalog/json/products_{client.s.supplier_pricelist}.json",
            Path(tmp) / "products.json",
            progress=lambda done, size: job_progress("products", "download", done / size if size else None, f"{done >> 20} МБ"),
        )
        return await import_products_file(f, n, prefer, limit, progress=lambda share: job_progress("products", "import", share))
