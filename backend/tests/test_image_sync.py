import pytest
from conftest import reset_db
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Category, Product, ProductImage
from app.sync.images import apply_image_lists


@pytest.fixture(autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        s.add(Category(id=1, name="Cat", slug="cat", path="/1/"))
        await s.flush()
        s.add(Product(sku=7, name="P", slug="p", category_id=1, search_text="p"))
        await s.commit()


def item(iid: int, is_main: bool = False, url: str | None = None) -> dict:
    return {"id": iid, "sku": 7, "deleted": False, "is_main": is_main, "url": url or f"product_images/with_watermark/{iid % 1000}/{iid}.jpg"}


async def images() -> list[tuple[int, int, int]]:
    async with SessionLocal() as s:
        rows = (await s.scalars(select(ProductImage).order_by(ProductImage.position))).all()
        return [(r.id, r.position, r.version) for r in rows]


async def main_image() -> int | None:
    async with SessionLocal() as s:
        return (await s.get(Product, 7)).main_image_id


async def test_main_photo_comes_first_even_if_listed_last():
    # real read_new response: the main photo is the last one
    assert await apply_image_lists([7], [item(11), item(12), item(10, is_main=True)]) == 3
    assert [(i, p) for i, p, _ in await images()] == [(10, 0), (11, 1), (12, 2)]
    assert await main_image() == 10


async def test_changed_url_bumps_version_and_removed_photos_are_deleted():
    await apply_image_lists([7], [item(10, is_main=True), item(11)])
    changed = await apply_image_lists([7], [item(10, is_main=True, url="product_images/with_watermark/1/1.jpg"), item(12, url=None) | {"deleted": True}])
    assert changed == 1
    assert await images() == [(10, 0, 2)]  # 11 is gone, 12 is deleted at the supplier


async def test_product_without_photos_gets_no_main_image():
    await apply_image_lists([7], [item(10, is_main=True)])
    await apply_image_lists([7], [])
    assert await images() == []
    assert await main_image() is None


async def test_main_photo_missing_at_supplier_falls_back_to_next():
    from app.supplier.client import SupplierNotFound
    from app.sync.images import process_one

    class MissingFiles:
        async def fetch_image(self, url, size="original"):
            raise SupplierNotFound(f"image {url}: HTTP 404")

    await apply_image_lists([7], [item(10, is_main=True), item(11), item(12)])
    assert await main_image() == 10
    assert not await process_one(MissingFiles(), None, 10, "model_files/x.jpg")  # 404: failed at once
    async with SessionLocal() as s:
        assert (await s.get(ProductImage, 10)).status == "failed"
    assert await main_image() == 11
    # re-reading the supplier list keeps the broken photo out of the main slot
    await apply_image_lists([7], [item(10, is_main=True), item(11), item(12)])
    assert await main_image() == 11


async def test_reprocessing_a_stale_photo_bumps_its_version():
    import io

    from PIL import Image

    from app.models.catalog import ImageStatus
    from app.sync.images import process_one

    buf = io.BytesIO()
    Image.new("RGB", (300, 300), "white").save(buf, "JPEG")

    class Supplier:
        async def fetch_image(self, url, size="original"):
            return buf.getvalue()

    await apply_image_lists([7], [item(10, is_main=True)])
    assert await process_one(Supplier(), None, 10, "x.jpg")
    assert await images() == [(10, 0, 1)]  # first processing keeps version 1
    async with SessionLocal() as s:
        (await s.get(ProductImage, 10)).status = ImageStatus.stale
        await s.commit()
    assert await process_one(Supplier(), None, 10, "x.jpg")
    async with SessionLocal() as s:
        img = await s.get(ProductImage, 10)
        assert (img.status, img.version) == ("ready", 2)


async def test_network_trouble_keeps_the_photo_queued():
    import pytest as _pytest

    from app.supplier.client import SupplierUnavailable
    from app.sync.images import process_one

    class Offline:
        async def fetch_image(self, url, size="original"):
            raise SupplierUnavailable("ConnectTimeout")

    await apply_image_lists([7], [item(10, is_main=True)])
    with _pytest.raises(SupplierUnavailable):
        await process_one(Offline(), None, 10, "x.jpg")
    async with SessionLocal() as s:
        img = await s.get(ProductImage, 10)
        assert (img.status, img.attempts) == ("pending", 0)
