"""Prices and stock: get_active_products (only in-stock items, limit 10/hour)."""

import logging
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select, update

from app.db import SessionLocal
from app.models import Category, Product
from app.models.base import utcnow
from app.site_settings import PricingSettings, get_settings_obj, retail_price
from app.supplier.client import SupplierClient

log = logging.getLogger(__name__)
BATCH = 5000


def _qty(item: dict, real: str, stars: str) -> int:
    v = item.get(real)
    if isinstance(v, (int, float)):
        return max(0, int(v))
    # older responses only have "*" / "**" / "***"
    return {1: 1, 2: 5, 3: 10}.get(str(item.get(stars) or "").count("*"), 0)


async def apply_stock(items: list[dict]) -> dict:
    now = utcnow()
    async with SessionLocal() as session:
        pricing = await get_settings_obj(session, PricingSettings)
        known = {
            sku: (rrp, path, override)
            for sku, rrp, path, override in (
                await session.execute(
                    select(Product.sku, Product.rrp, Category.path, Product.price_override).outerjoin(
                        Category, Category.id == Product.category_id
                    )
                )
            ).all()
        }

    rows = []
    for it in items:
        sku = it.get("sku")
        if sku not in known:
            continue  # new product, appears after the next catalog sync
        try:
            supplier_price = Decimal(str(it["price"])).quantize(Decimal("0.01"))
        except (KeyError, InvalidOperation):
            continue
        if supplier_price <= 0:
            continue
        rrp, path, override = known[sku]
        rows.append({
            "sku": sku,
            "supplier_price": supplier_price,
            "price": override or retail_price(supplier_price, rrp, path, pricing),
            "qty_central": _qty(it, "real_qty", "qty"),
            "qty_nearest": _qty(it, "nearest_logistic_center_real_qty", "nearest_logistic_center_qty"),
            "delivery_days": it.get("delivery_days"),
            "in_stock": True,
            "is_marked": bool(it.get("is_mark")),
            "stock_updated_at": now,
        })

    async with SessionLocal() as session:
        for i in range(0, len(rows), BATCH):
            await session.execute(update(Product), rows[i : i + BATCH])
        res = await session.execute(
            update(Product)
            .where(Product.in_stock, (Product.stock_updated_at < now) | Product.stock_updated_at.is_(None))
            .values(in_stock=False, qty_central=0, qty_nearest=0, stock_updated_at=now)
        )
        await session.commit()
    await recount_categories()
    log.info("stock: %d in stock, %d went out of stock, %d unknown skus", len(rows), res.rowcount, len(items) - len(rows))
    return {"in_stock": len(rows), "out_of_stock": res.rowcount, "unknown": len(items) - len(rows)}


async def reprice_all() -> int:
    """Recompute retail prices after the pricing settings changed (fixed prices set by admin stay)."""
    async with SessionLocal() as session:
        pricing = await get_settings_obj(session, PricingSettings)
        data = (
            await session.execute(
                select(Product.sku, Product.supplier_price, Product.rrp, Category.path, Product.price_override)
                .outerjoin(Category, Category.id == Product.category_id)
                .where(Product.supplier_price.is_not(None))
            )
        ).all()
        rows = [
            {"sku": sku, "price": override or retail_price(sp, rrp, path, pricing)}
            for sku, sp, rrp, path, override in data
        ]
        for i in range(0, len(rows), BATCH):
            await session.execute(update(Product), rows[i : i + BATCH])
        await session.commit()
    return len(rows)


async def recount_categories() -> None:
    """product_count = in-stock products in the category and all its descendants."""
    async with SessionLocal() as session:
        direct = dict(
            (
                await session.execute(
                    select(Product.category_id, func.count())
                    .where(Product.in_stock, Product.is_active, ~Product.is_hidden, Product.category_id.is_not(None))
                    .group_by(Product.category_id)
                )
            ).all()
        )
        totals: dict[int, int] = defaultdict(int)
        for cid, path in (await session.execute(select(Category.id, Category.path))).all():
            n = direct.get(cid, 0)
            if n:
                for anc in path.strip("/").split("/"):
                    totals[int(anc)] += n
        ids = (await session.scalars(select(Category.id))).all()
        await session.execute(update(Category), [{"id": i, "product_count": totals.get(i, 0)} for i in ids])
        await session.commit()


async def sync_stock(client: SupplierClient) -> dict:
    return await apply_stock(await client.get_active_products())
