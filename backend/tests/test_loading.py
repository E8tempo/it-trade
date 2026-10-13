"""Photo loading: the order of the queue, the per-product limit, processing versions, the trial batch
and the admin page that shows all of it."""

import io

import pytest
from conftest import login, reset_db
from PIL import Image

from app.api.admin import loading
from app.auth import ensure_admin
from app.db import SessionLocal
from app.images.processing import VERSION
from app.models import Category, Product, ProductImage
from app.models.base import utcnow
from app.models.catalog import ImageStatus
from app.site_settings import ImageSettings
from app.sync.images import next_pending, pick_trial, process_one

# products 1 and 2 are in stock with 10 photos each, product 3 is out of stock with 2;
# photo id = sku * 100 + position, the first one is the main photo
PHOTOS = {1: 10, 2: 10, 3: 2}


@pytest.fixture(autouse=True)
async def db():
    await reset_db()
    loading.clear_cache()
    async with SessionLocal() as s:
        await ensure_admin(s)
        s.add(Category(id=1, name="Cat", slug="cat", path="/1/"))
        await s.flush()
        for sku, n in PHOTOS.items():
            s.add(Product(sku=sku, name=f"P{sku}", slug=f"p{sku}", category_id=1, search_text=f"p{sku}", in_stock=sku != 3, has_image=True, price=100))
            await s.flush()
            s.add_all(ProductImage(id=sku * 100 + pos, sku=sku, source_url=f"{sku}/{pos}.jpg", position=pos) for pos in range(n))
            await s.flush()
            p = await s.get(Product, sku)
            p.main_image_id, p.images_synced_at = sku * 100, utcnow()
        await s.commit()


@pytest.fixture
async def admin(client):
    token = await login(client, "admin@example.com", "admin-pass-123")
    client.cookies.clear()
    client.headers["Authorization"] = f"Bearer {token}"
    return client


def white_jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (600, 600), "white").save(buf, "JPEG")
    return buf.getvalue()


class Supplier:
    image_rps = 3.0

    async def fetch_image(self, url, size="original"):
        return white_jpeg()


async def set_photos(**fields_by_id) -> None:
    async with SessionLocal() as s:
        for iid, fields in fields_by_id.items():
            img = await s.get(ProductImage, int(iid.removeprefix("p")))
            for k, v in fields.items():
                setattr(img, k, v)
        await s.commit()


async def queue(cfg: ImageSettings, **kw) -> list[int]:
    return [iid for iid, _ in await next_pending(100, cfg, **kw)]


async def test_queue_takes_all_main_photos_first_then_the_others_up_to_the_limit():
    assert await queue(ImageSettings()) == [sku * 100 + pos for pos in range(8) for sku in (1, 2)]
    assert await queue(ImageSettings(per_product=3)) == [100, 200, 101, 201, 102, 202]
    assert await queue(ImageSettings(gallery=False)) == [100, 200]  # the others on the first view
    assert (await queue(ImageSettings(), include_out_of_stock=True))[-2:] == [300, 301]


async def test_photos_of_an_older_version_are_processed_again_after_the_new_ones():
    await set_photos(
        p100={"status": ImageStatus.ready, "algo_version": VERSION - 1},
        p101={"status": ImageStatus.ready, "algo_version": None},  # processed before versions were stored
        p200={"status": ImageStatus.ready, "algo_version": VERSION},
        p201={"status": ImageStatus.stale, "algo_version": VERSION},  # queued again from the admin panel
    )
    ids = await queue(ImageSettings())
    assert 200 not in ids
    assert ids[-3:] == [201, 100, 101] and len(ids) == 16 - 1  # new photos first, then 201, then old versions
    assert 100 not in await queue(ImageSettings(reprocess=False))


async def test_processing_stamps_the_version_and_a_failed_redo_keeps_the_old_files():
    from app.supplier.client import SupplierNotFound

    res = await process_one(Supplier(), None, 100, "1/0.jpg")
    assert res is not None and res.ms >= 0 and res.wm_left is None  # a white photo: no mark found
    async with SessionLocal() as s:
        img = await s.get(ProductImage, 100)
        assert (img.status, img.algo_version, img.version) == ("ready", VERSION, 1)

    await set_photos(p100={"algo_version": VERSION - 1})
    assert await process_one(Supplier(), None, 100, "1/0.jpg")
    async with SessionLocal() as s:
        img = await s.get(ProductImage, 100)
        assert (img.algo_version, img.version) == (VERSION, 2)  # new files: a new URL past browser caches

    class Gone:
        async def fetch_image(self, url, size="original"):
            raise SupplierNotFound(f"image {url}: HTTP 404")

    await set_photos(p100={"algo_version": VERSION - 1})
    assert await process_one(Gone(), None, 100, "1/0.jpg") is None
    async with SessionLocal() as s:
        img = await s.get(ProductImage, 100)
        assert img.status == "ready" and "404" in img.error  # still shown, with the old files
    assert 100 not in await queue(ImageSettings())  # and not tried again and again


async def test_trial_takes_random_main_photos_not_processed_yet_first():
    assert sorted(iid for iid, _ in await pick_trial(5)) == [100, 200]  # two products in stock
    await set_photos(p100={"status": ImageStatus.ready, "algo_version": VERSION})
    assert [iid for iid, _ in await pick_trial(1)] == [200]


async def test_trial_batch_is_run_by_the_worker_and_measured(admin):
    from app.worker import run_trial

    r = await admin.post("/api/admin/loading/trial", json={"count": 10})
    assert r.status_code == 200 and r.json()["status"] == "queued"
    assert (await admin.post("/api/admin/loading/trial", json={"count": 10})).status_code == 409

    state: dict = {}
    assert await run_trial(Supplier(), None, state)
    assert not await run_trial(Supplier(), None, state)  # nothing queued any more

    loading.clear_cache()
    trial = (await admin.get("/api/admin/loading")).json()["trial"]
    assert (trial["status"], trial["done"], trial["failed"], trial["ready"], trial["no_mark"]) == ("done", 2, 0, 2, 2)
    assert trial["capacity"] > 0 and trial["ms_median"] >= 0
    photos = (await admin.get("/api/admin/loading/photos", params={"kind": "trial"})).json()
    assert sorted(p["id"] for p in photos) == [100, 200] and all(p["thumb"].endswith(".webp?v=1") for p in photos)


async def test_loading_page_counts_every_stage(admin):
    await set_photos(
        p100={"status": ImageStatus.ready, "algo_version": VERSION},
        p101={"status": ImageStatus.ready, "algo_version": VERSION - 1},
        p102={"status": ImageStatus.ready, "algo_version": VERSION, "wm_left": 25.0, "wm_template": "big", "processed_at": utcnow()},
        p200={"status": ImageStatus.failed, "error": "image 2/0.jpg: HTTP 404", "attempts": 3},
    )
    d = (await admin.get("/api/admin/loading")).json()
    stages = {st["key"]: st for st in d["stages"]}
    assert (stages["main"]["done"], stages["main"]["total"], stages["main"]["failed"]) == (1, 1, 1)  # 200 failed: apart
    assert (stages["gallery"]["done"], stages["gallery"]["total"]) == (2, 14)  # positions 1..7 of both products
    assert (stages["redo"]["done"], stages["redo"]["total"]) == (2, 3)  # 101 is of the older version
    assert stages["image_lists"]["done"] == stages["image_lists"]["total"] == 2
    assert d["speed"]["last_10_min"] == 1 and d["speed"]["source"] == "expected"
    o = d["overview"]
    assert (o["products"], o["in_stock"], o["photos_done"], o["photos_total"]) == (3, 2, 3, 15)  # 1 + 14 to load
    checks = {c["key"]: c["status"] for c in d["checks"]}
    assert checks["supplier"] == "error" and checks["worker"] == "error"  # no credentials, no worker in tests
    assert checks["watermark"] == "ok" and checks["cpu"] == "wait"
    assert d["failed"] == {"total": 1, "reasons": [{"reason": "У поставщика нет файла (HTTP 404)", "count": 1}]}
    assert (d["quality"]["checked"], d["quality"]["visible_left"]) == (3, 1)
    left = (await admin.get("/api/admin/loading/photos", params={"kind": "left"})).json()
    assert [p["id"] for p in left] == [102]

    assert (await admin.post("/api/admin/images/retry-failed")).json() == {"queued": 1}
    assert (await admin.put("/api/admin/settings/images", json={**d["settings"], "download_rps": 4.9})).status_code == 422
    r = await admin.put("/api/admin/settings/images", json={**d["settings"], "paused": True, "per_product": 3})
    assert r.status_code == 200
    d = (await admin.get("/api/admin/loading")).json()  # the settings change clears the page cache
    stages = {st["key"]: st for st in d["stages"]}
    assert d["settings"]["paused"] and stages["gallery"]["total"] == 4 and d["failed"]["total"] == 0


async def test_site_shows_only_the_first_photos_of_a_product(admin, client):
    await set_photos(**{f"p{100 + pos}": {"status": ImageStatus.ready, "width": 800, "height": 800} for pos in range(10)})
    assert len((await client.get("/api/products/1")).json()["images"]) == 8
    settings = (await admin.get("/api/admin/settings/images")).json()
    await admin.put("/api/admin/settings/images", json={**settings, "per_product": 3})
    images = (await client.get("/api/products/1")).json()["images"]
    assert [i["id"] for i in images] == [100, 101, 102] and set(images[0]["urls"]) == {"lg", "md"}
    # a photo beyond the limit is not downloaded on request either
    assert (await client.get("/media/products/105/105_md.webp")).status_code == 404


async def test_catalog_import_shows_how_far_it_is(admin, tmp_path, monkeypatch):
    import json

    from app.models import JobState
    from app.sync import products

    monkeypatch.setattr(products, "PROGRESS_EVERY", 2)
    f = tmp_path / "products.json"
    f.write_text(json.dumps([{"sku": 1000 + i, "name": f"P{i}", "category": 1, "has_image": True} for i in range(5)]))
    shares: list[float] = []

    async def progress(share: float) -> None:
        shares.append(share)

    assert (await products.import_products_file(f, progress=progress))["products"] == 5
    assert len(shares) == 2 and 0 < shares[0] <= shares[1] <= 1

    # a running import on the page: the file is downloaded, half of the products written
    async with SessionLocal() as s:
        s.add(JobState(name="products", last_started_at=utcnow(), info={"phase": "import", "progress": 0.5}))
        await s.commit()
    stage = next(st for st in (await admin.get("/api/admin/loading")).json()["stages"] if st["key"] == "products")
    assert (stage["status"], stage["progress"], stage["phase"]) == ("running", 0.65, "запись товаров в базу")


async def test_fresh_install_shows_every_stage_waiting(admin):
    from sqlalchemy import delete, update

    async with SessionLocal() as s:  # nothing loaded yet: no categories, products, photos or job runs
        await s.execute(update(Product).values(main_image_id=None))
        await s.execute(delete(ProductImage))
        await s.execute(delete(Product))
        await s.execute(delete(Category))
        await s.commit()
    loading.clear_cache()
    d = (await admin.get("/api/admin/loading")).json()
    assert {st["key"]: st["status"] for st in d["stages"]} == dict.fromkeys(
        ("categories", "products", "stock", "image_lists", "main", "gallery", "redo"), "waiting"
    )
    assert (d["overview"]["products"], d["overview"]["photos_total"]) == (0, 0)
