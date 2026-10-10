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
