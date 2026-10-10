"""Maintenance commands.

    python -m app.cli sync categories|products|stock|images     run one sync job now
    python -m app.cli import-categories FILE                     import a downloaded catalog_tree_N.json
    python -m app.cli import-products FILE                       import a downloaded products_N.json
    python -m app.cli process-images [N]                         process N pending images in the foreground
    python -m app.cli reprice                                    recompute retail prices
    python -m app.cli requeue-images [VARIANT]                   reprocess ready images (e.g. "small") after calibration
    python -m app.cli watermark-test IN.jpg OUT.jpg              remove the watermark from a local file
    python -m app.cli watermark-sample DIR [N]                   download N random supplier originals into DIR
    python -m app.cli watermark-calibrate DIR                    rebuild watermark templates from DIR/*.jpg
    python -m app.cli probe-marketplace-images SKU               try the partner/marketplace image endpoints
"""

import argparse
import asyncio
import json
import logging
from pathlib import Path


async def _sync(name: str) -> None:
    from app.supplier.client import SupplierClient
    from app.worker import jobs, run_job

    job = next(j for j in jobs() if j.name == {"images": "image_lists"}.get(name, name))
    async with SupplierClient() as client:
        await run_job(job, client)


async def _process(n: int) -> None:
    from app.supplier.client import SupplierClient
    from app.sync.images import next_pending, process_one

    async with SupplierClient() as client:
        batch = await next_pending(n, include_out_of_stock=True)
        ok = await asyncio.gather(*(process_one(client, None, iid, url) for iid, url in batch))
        print(f"{sum(ok)}/{len(ok)} processed")


async def _probe(sku: int) -> None:
    """Checks whether the supplier exposes watermark-free images to this account."""
    from app.supplier.client import SupplierClient

    async with SupplierClient() as client:
        for model, method in (
            ("products_clients_images", "read_new"),
            ("partner_product_images", "read_internal_marketplace_images"),
            ("partner_product_images", "read_client_images"),
        ):
            try:
                body = await client.call("platform", model, method, filter=[{"property": "sku", "operator": "=", "value": sku}])
                print(f"== {model}.{method}\n{json.dumps(body.get('data'), ensure_ascii=False, indent=1)[:3000]}")
            except Exception as e:  # noqa: BLE001
                print(f"== {model}.{method}: {e}")


async def _watermark_sample(folder: Path, n: int) -> None:
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import ProductImage
    from app.supplier.client import SupplierClient, SupplierError

    folder.mkdir(parents=True, exist_ok=True)
    async with SessionLocal() as session:
        rows = (await session.execute(select(ProductImage.id, ProductImage.source_url).order_by(func.random()).limit(n))).all()
    async with SupplierClient() as client:
        for iid, url in rows:
            try:
                (folder / f"{iid}.jpg").write_bytes(await client.fetch_image(url, size="original"))
            except SupplierError as e:
                print(e)
    print(f"{len(rows)} images in {folder}")


async def _requeue(variant: str | None) -> None:
    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import ProductImage
    from app.models.catalog import ImageStatus

    q = update(ProductImage).where(ProductImage.status == ImageStatus.ready)
    if variant:
        q = q.where(ProductImage.wm_template.in_([variant, f"{variant}-rot"]))
    async with SessionLocal() as session:
        res = await session.execute(q.values(status=ImageStatus.pending, attempts=0))
        await session.commit()
    print(res.rowcount, "images queued")


def _watermark_test(src: Path, dst: Path) -> None:
    import numpy as np
    from PIL import Image

    from app.images.watermark import default_remover

    rgb = np.asarray(Image.open(src).convert("RGB"))
    clean, det = default_remover().remove(rgb)
    Image.fromarray(clean).save(dst, quality=95)
    print(det or "no watermark detected")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="python -m app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync").add_argument("job", choices=["categories", "products", "stock", "images"])
    sub.add_parser("import-categories").add_argument("file", type=Path)
    ip = sub.add_parser("import-products")
    ip.add_argument("file", type=Path)
    ip.add_argument("--sample", type=int, default=None, help="max products per category (default: CATALOG_SAMPLE_PER_CATEGORY)")
    sub.add_parser("process-images").add_argument("n", type=int, nargs="?", default=50)
    sub.add_parser("reprice")
    sub.add_parser("requeue-images").add_argument("variant", nargs="?", choices=["big", "mid", "small"])
    wt = sub.add_parser("watermark-test")
    wt.add_argument("src", type=Path)
    wt.add_argument("dst", type=Path)
    ws = sub.add_parser("watermark-sample")
    ws.add_argument("dir", type=Path)
    ws.add_argument("n", type=int, nargs="?", default=2000)
    sub.add_parser("watermark-calibrate").add_argument("dir", type=Path)
    sub.add_parser("probe-marketplace-images").add_argument("sku", type=int)
    a = p.parse_args()

    match a.cmd:
        case "sync":
            asyncio.run(_sync(a.job))
        case "import-categories":
            from app.sync.categories import import_tree_file

            print(asyncio.run(import_tree_file(a.file)))
        case "import-products":
            from app.sync.products import import_products_file

            from app.config import get_settings

            n = a.sample if a.sample is not None else get_settings().catalog_sample_per_category
            print(asyncio.run(import_products_file(a.file, n)))
        case "process-images":
            asyncio.run(_process(a.n))
        case "reprice":
            from app.sync.stock import reprice_all

            print(asyncio.run(reprice_all()), "products repriced")
        case "requeue-images":
            asyncio.run(_requeue(a.variant))
        case "watermark-test":
            _watermark_test(a.src, a.dst)
        case "watermark-sample":
            asyncio.run(_watermark_sample(a.dir, a.n))
        case "watermark-calibrate":
            from app.images.calibrate import calibrate

            print(calibrate(a.dir))
        case "probe-marketplace-images":
            asyncio.run(_probe(a.sku))


if __name__ == "__main__":
    main()
