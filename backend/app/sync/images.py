"""Product image lists (products_clients_images.read_new, <=100 skus per call, 2/s) and processing queue."""

import asyncio
import logging
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import timedelta

from sqlalchemy import case, delete, or_, select, update

from app.config import get_settings
from app.db import SessionLocal
from app.images.processing import delete_image_files, process_image
from app.models import Product, ProductImage
from app.models.base import utcnow
from app.models.catalog import ImageStatus
from app.supplier.client import SupplierClient, SupplierError, SupplierNotFound, SupplierUnavailable

log = logging.getLogger(__name__)
LIST_BATCH = 100
REFRESH_AFTER = timedelta(days=14)
MAX_ATTEMPTS = 3


async def _skus_needing_lists(limit: int) -> list[int]:
    stale = utcnow() - REFRESH_AFTER
    async with SessionLocal() as session:
        q = (
            select(Product.sku)
            .where(
                Product.is_active,
                Product.has_image,
                or_(Product.images_synced_at.is_(None), Product.in_stock & (Product.images_synced_at < stale)),
            )
            .order_by(Product.in_stock.desc(), Product.images_synced_at.is_not(None), Product.sku)
            .limit(limit)
        )
        return list((await session.scalars(q)).all())


async def apply_image_lists(skus: list[int], items: list[dict]) -> int:
    """Store the supplier image list of `skus`; returns the number of new/changed images."""
    media_root = get_settings().media_root
    now = utcnow()
    by_sku: dict[int, list[dict]] = defaultdict(list)
    for it in items:
        if not it.get("deleted") and it.get("url") and it.get("sku") in skus:
            by_sku[it["sku"]].append(it)
    changed = 0
    ids = [int(it["id"]) for imgs in by_sku.values() for it in imgs]
    async with SessionLocal() as session:
        existing = {
            img.id: img
            for img in (
                await session.scalars(select(ProductImage).where(or_(ProductImage.sku.in_(skus), ProductImage.id.in_(ids))))
            ).all()
        }
        keep: set[int] = set()
        main: dict[int, int | None] = {sku: None for sku in skus}
        for sku, imgs in by_sku.items():
            # the main photo (`is_main`, often last in the response) first, then the supplier order
            imgs.sort(key=lambda it: not it.get("is_main"))
            for pos, it in enumerate(imgs):
                iid = int(it["id"])
                row = existing.get(iid)
                if iid in keep or (row is not None and row.sku != sku and row.sku not in main):
                    continue  # the same image record is already attached to another product
                keep.add(iid)
                if main[sku] is None and not (row is not None and row.status == ImageStatus.failed and row.source_url == it["url"]):
                    main[sku] = iid  # a photo that is broken at the supplier is not used as the main one
                if row is None:
                    session.add(ProductImage(id=iid, sku=sku, source_url=it["url"], position=pos, priority=it.get("priority") or 0))
                    changed += 1
                    continue
                row.sku, row.position, row.priority = sku, pos, it.get("priority") or 0
                if row.source_url != it["url"]:
                    row.source_url, row.version = it["url"], row.version + 1
                    row.status, row.attempts, row.error = ImageStatus.pending, 0, None
                    changed += 1
        gone = [iid for iid, row in existing.items() if row.sku in main and iid not in keep]
        await session.flush()
        for sku, iid in main.items():
            await session.execute(update(Product).where(Product.sku == sku).values(main_image_id=iid, images_synced_at=now))
        if gone:
            await session.execute(delete(ProductImage).where(ProductImage.id.in_(gone)))
        await session.commit()
    for iid in gone:
        delete_image_files(media_root, iid)
    return changed


async def sync_image_lists(client: SupplierClient, max_products: int = 20000) -> dict:
    skus = await _skus_needing_lists(max_products)
    changed = 0
    for i in range(0, len(skus), LIST_BATCH):
        batch = skus[i : i + LIST_BATCH]
        changed += await apply_image_lists(batch, await client.get_product_images(batch))
    log.info("image lists: %d products checked, %d images new/changed", len(skus), changed)
    return {"products": len(skus), "images_changed": changed}


# --- processing ---------------------------------------------------------------------------------


async def replace_failed_main(session, sku: int) -> None:
    """If the product's main photo failed, show its next photo instead."""
    product = await session.get(Product, sku)
    if product is None or product.main_image_id is None:
        return
    main = await session.get(ProductImage, product.main_image_id)
    if main is None or main.status != ImageStatus.failed:
        return
    product.main_image_id = await session.scalar(
        select(ProductImage.id)
        .where(ProductImage.sku == sku, ProductImage.status != ImageStatus.failed)
        .order_by(ProductImage.position)
        .limit(1)
    )


async def next_pending(limit: int, *, include_out_of_stock: bool, gallery: bool = True) -> list[tuple[int, str]]:
    """Main images of in-stock products first, then their other images (unless `gallery` is off:
    those are then processed on first view), then out-of-stock products if requested."""
    async with SessionLocal() as session:
        base = (
            select(ProductImage.id, ProductImage.source_url)
            .join(Product, Product.sku == ProductImage.sku)
            .where(ProductImage.status.in_((ImageStatus.pending, ImageStatus.stale)), ProductImage.attempts < MAX_ATTEMPTS)
        )
        # never processed first, re-processing of already shown photos after that
        order = (case((ProductImage.status == ImageStatus.pending, 0), else_=1), ProductImage.position, ProductImage.id)
        if not gallery:
            base = base.where(ProductImage.position == 0)
        rows = (await session.execute(base.where(Product.in_stock).order_by(*order).limit(limit))).all()
        if not rows and include_out_of_stock:
            rows = (await session.execute(base.order_by(*order).limit(limit))).all()
        return [tuple(r) for r in rows]


async def process_one(client: SupplierClient, pool: ProcessPoolExecutor | None, image_id: int, url: str) -> bool:
    """Downloads, cleans and stores one photo. Raises SupplierUnavailable on network trouble
    (the image stays queued and its attempts are not used up)."""
    s = get_settings()
    try:
        data = await client.fetch_image(url, size="original")
        if pool is None:
            res = await asyncio.to_thread(process_image, data, str(s.media_root), image_id)
        else:
            res = await asyncio.get_running_loop().run_in_executor(pool, process_image, data, str(s.media_root), image_id)
    except SupplierUnavailable:
        raise
    except (SupplierError, OSError, ValueError) as e:
        log.warning("image %s (%s) failed: %s", image_id, url, e)
        async with SessionLocal() as session:
            img = await session.get(ProductImage, image_id)
            if img:
                img.attempts = MAX_ATTEMPTS if isinstance(e, SupplierNotFound) else img.attempts + 1
                img.error = str(e)[:500]
                if img.attempts >= MAX_ATTEMPTS:
                    img.status = ImageStatus.failed
                    await session.flush()
                    await replace_failed_main(session, img.sku)
                await session.commit()
        return False
    async with SessionLocal() as session:
        await session.execute(
            update(ProductImage)
            .where(ProductImage.id == image_id)
            .values(
                # re-processed files keep their paths: a new version changes the URL (?v=) past browser caches
                version=case((ProductImage.status == ImageStatus.stale, ProductImage.version + 1), else_=ProductImage.version),
                status=ImageStatus.ready,
                width=res.width,
                height=res.height,
                wm_template=res.wm_template,
                wm_score=res.wm_score,
                error=None,
                processed_at=utcnow(),
            )
        )
        await session.commit()
    return True
