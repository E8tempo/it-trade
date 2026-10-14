from decimal import Decimal

import pytest
from conftest import login, register, reset_db

from app.auth import ensure_admin
from app.db import SessionLocal
from app.models import Category, Product, ProductImage
from app.models.catalog import ImageStatus
from app.sync.stock import apply_stock


async def db_price(sku: int) -> tuple:
    """The retail cash and cashless prices as stored (the public catalog shows none)."""
    async with SessionLocal() as s:
        p = await s.get(Product, sku)
        return p.price, p.price_retail_cashless


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        await ensure_admin(s)
    async with SessionLocal() as s:
        s.add_all([
            Category(id=1, name="Компьютеры", slug="kompyutery", path="/1/", depth=0, leaf=False),
            Category(id=2, name="Ноутбуки", slug="noutbuki", path="/1/2/", depth=1, parent_id=1),
            Category(id=3, name="Пустая", slug="pustaya", path="/3/", depth=0),
        ])
        await s.flush()
        for sku, name, vendor in [(10, "Ноутбук Lenovo V15", "Lenovo"), (11, "Ноутбук HP 250", "HP"), (12, "Мышь HP X200", "HP")]:
            s.add(Product(sku=sku, name=name, slug="x", vendor=vendor, part=f"P{sku}", category_id=2, search_text=f"{name} p{sku} {vendor}".lower()))
        await s.flush()
        s.add(ProductImage(id=500, sku=10, source_url="product_images/with_watermark/500/500.jpg", status=ImageStatus.ready))
        await s.flush()
        p = await s.get(Product, 10)
        p.main_image_id = 500
        await s.commit()
    await apply_stock([
        {"sku": 10, "price": 50000, "real_qty": 3},
        {"sku": 11, "price": 40000, "real_qty": 1},
        {"sku": 999, "price": 1},  # unknown sku is ignored
    ])
    yield


async def test_category_tree_hides_empty(client):
    tree = (await client.get("/api/categories")).json()
    assert [n["id"] for n in tree] == [1]
    assert tree[0]["product_count"] == 2
    assert tree[0]["children"][0]["id"] == 2


async def test_products_listing_and_filters(client):
    page = (await client.get("/api/products", params={"category": 1, "sort": "price_asc"})).json()
    assert page["total"] == 2  # sku 12 is out of stock
    assert [i["sku"] for i in page["items"]] == [11, 10]
    assert page["items"][1]["image"]["urls"]["md"].startswith("/media/products/500/500_md.webp")
    assert {v["name"] for v in page["vendors"]} == {"Lenovo", "HP"}
    assert "price" not in page["items"][0] and "price_min" not in page  # the site sells to businesses: no prices for guests
    assert await db_price(11) == (Decimal("48000"), Decimal("48000"))  # 20% markup, rounded to 10

    page = (await client.get("/api/products", params={"q": "ноутбук lenovo"})).json()
    assert [i["sku"] for i in page["items"]] == [10]
    page = (await client.get("/api/products", params={"vendor": "HP"})).json()
    assert [i["sku"] for i in page["items"]] == [11]


async def test_product_detail(client):
    d = (await client.get("/api/products/10")).json()
    assert [b["id"] for b in d["breadcrumbs"]] == [1, 2]
    assert not {"price", "price_cashless"} & d.keys()
    assert await db_price(10) == (Decimal(60000), Decimal(60000))  # every price type has the default rules
    assert d["images"][0]["id"] == 500
    assert (await client.get("/api/products/424242")).status_code == 404


async def test_admin_requires_admin_role_and_reprices(client):
    assert (await client.get("/api/admin/suppliers/itp/pricing")).status_code == 401
    customer = (await register(client, "buyer@example.com"))["access_token"]
    client.cookies.clear()
    assert (await client.get("/api/admin/suppliers/itp/pricing", headers={"Authorization": f"Bearer {customer}"})).status_code == 403

    admin = {"Authorization": f"Bearer {await login(client, 'admin@example.com', 'admin-pass-123')}"}
    client.cookies.clear()
    r = await client.put(
        "/api/admin/suppliers/itp/pricing/retail_cash",
        json={"markup_percent": 10, "round_to": 1, "use_rrp": False, "min_markup": 0, "category_markups": {}},
        headers=admin,
    )
    assert r.status_code == 200
    assert await db_price(11) == (Decimal(44000), Decimal(48000))  # only the retail cash rules changed
    # the markup rules are no longer a generic settings section
    assert (await client.get("/api/admin/settings/pricing", headers=admin)).status_code == 404


async def test_category_tree_depth(client):
    full = (await client.get("/api/categories")).json()
    assert full[0]["children"][0]["id"] == 2
    trimmed = (await client.get("/api/categories", params={"depth": 1})).json()
    assert trimmed[0]["id"] == 1 and trimmed[0]["children"] == []
    # the cached full tree is not affected by trimming
    assert (await client.get("/api/categories")).json()[0]["children"][0]["id"] == 2


async def test_showcase_filters(client):
    page = (await client.get("/api/products", params={"with_image": "true"})).json()
    assert [i["sku"] for i in page["items"]] == [10]  # the only product with a ready main photo
    page = (await client.get("/api/products", params={"category": 1, "exclude": 10})).json()
    assert [i["sku"] for i in page["items"]] == [11]
    page = (await client.get("/api/products", params={"q": "ноутбук", "facets": "false"})).json()
    assert page["vendors"] == [] and page["total"] == 2
