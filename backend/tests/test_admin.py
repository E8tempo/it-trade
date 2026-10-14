import io
from decimal import Decimal

import numpy as np
import pytest
from conftest import login, reset_db
from PIL import Image
from test_watermark import apply_watermark, expected_detection, synthetic_photo

from app.auth import ensure_admin
from app.db import SessionLocal
from app.images.watermark import default_remover
from app.models import Category, PriceType, Product, ProductImage
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
        ])
        await s.flush()
        for sku, name in [(10, "Ноутбук Lenovo V15"), (11, "Ноутбук HP 250"), (12, "Мышь HP X200")]:
            s.add(Product(sku=sku, name=name, slug=f"p{sku}", category_id=2, search_text=name.lower()))
        await s.commit()
    await apply_stock([{"sku": 10, "price": 50000, "real_qty": 3}, {"sku": 11, "price": 40000, "real_qty": 1}])
    yield


@pytest.fixture
async def admin(client):
    token = await login(client, "admin@example.com", "admin-pass-123")
    client.cookies.clear()
    client.headers["Authorization"] = f"Bearer {token}"
    return client


async def test_pricing_preview_and_impact(admin):
    rules = {"markup_percent": 20, "category_markups": {"1": 10}, "min_markup": 500, "round_to": 100, "use_rrp": False}
    r = await admin.post("/api/admin/pricing/preview", json={"settings": rules, "supplier_price": 1234, "category_id": 2})
    d = r.json()
    assert r.status_code == 200, r.text
    # the nearest category with a rule is the parent: 1234 * 1.10 = 1357.4, floor 1734 -> rounded up to 1800
    assert d["markup_percent"] == 10 and d["markup_category"]["id"] == 1
    assert d["floor"] == 1734 and d["price"] == 1800 and d["margin"] == 566
    assert [c["id"] for c in d["category_path"]] == [1, 2]
    # the tried rules are retail cash's (the default type), the other types keep the saved ones (20%, rounded to 10)
    assert d["by_type"] == {"retail_cash": 1800, "retail_cashless": 1490, "wholesale_cash": 1490, "wholesale_cashless": 1490}

    # saved rules are the defaults (20%): 50000 -> 60000, 40000 -> 48000; with 25% both go up
    r = await admin.post("/api/admin/pricing/impact", json={"settings": {**rules, "markup_percent": 25, "category_markups": {}, "min_markup": 0}})
    d = r.json()
    assert (d["products"], d["changed"], d["up"], d["down"]) == (2, 2, 2, 0)
    assert (d["avg_markup_before"], d["avg_markup_after"]) == (20.0, 25.0)
    assert d["examples"][0] == {"sku": 10, "name": "Ноутбук Lenovo V15", "supplier_price": 50000, "before": 60000, "after": 62500}
    assert d["above_retail"] is None  # only counted for the wholesale types


async def test_fixed_price_and_hiding(admin, client):
    r = await admin.patch("/api/admin/products/10", json={"price_overrides": {"retail_cash": 55555, "wholesale_cash": 50500.5}})
    d = r.json()
    assert r.status_code == 200 and d["price"] == 55555 and d["price_overrides"] == {"retail_cash": 55555, "wholesale_cash": 50500.5}
    assert d["prices"] == {"retail_cash": 55555, "retail_cashless": 60000, "wholesale_cash": 50500.5, "wholesale_cashless": 60000}
    # fixed prices survive repricing and stock updates, the other types follow their rules
    for t in PriceType:
        r = await admin.put(f"/api/admin/suppliers/itp/pricing/{t}", json={"markup_percent": 30, "round_to": 1, "use_rrp": False})
        assert r.status_code == 200
    await apply_stock([{"sku": 10, "price": 51000, "real_qty": 3}, {"sku": 11, "price": 40000, "real_qty": 1}])
    assert await db_price(10) == (Decimal(55555), Decimal(66300))
    r = await admin.patch("/api/admin/products/10", json={"price_overrides": {"retail_cash": None}})
    assert r.json()["price_overrides"] == {"wholesale_cash": 50500.5} and r.json()["price"] == 66300
    r = await admin.patch("/api/admin/products/10", json={"price_overrides": {"wholesale_cash": None}})
    assert r.json()["price_overrides"] == {} and r.json()["prices"]["wholesale_cash"] == 66300

    r = await admin.get("/api/admin/products", params={"q": "ноутбук", "sort": "price"})
    assert [p["sku"] for p in r.json()["items"]] == [10, 11]
    assert (await admin.patch("/api/admin/products/11", json={"is_hidden": True})).json()["is_hidden"] is True
    assert (await client.get("/api/products/11")).status_code == 404
    listing = (await client.get("/api/products", params={"q": "ноутбук"})).json()
    assert [p["sku"] for p in listing["items"]] == [10]
    assert (await admin.get("/api/admin/products", params={"hidden": True})).json()["total"] == 1


async def test_order_lifecycle(admin):
    r = await admin.post(
        "/api/admin/orders",
        json={
            "customer_name": "Иван",
            "phone": "+7 (978) 123-45-67",
            "delivery": "courier",
            "address": "Симферополь, ул. Пушкина, 1",
            "delivery_price": 300,
            "items": [{"sku": 10, "qty": 2}, {"sku": 12, "qty": 1, "price": 990}],
        },
    )
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["number"] == f"{o['id']:06d}" and o["status"] == "new" and o["phone"] == "+79781234567"
    assert (o["payment_method"], o["price_type"], o["user_id"]) == ("cash", "retail_cash", None)
    price10 = float(o["items"][0]["price"])
    assert float(o["items_total"]) == price10 * 2 + 990 and float(o["total"]) == price10 * 2 + 990 + 300
    assert len(o["events"]) == 1

    r = await admin.patch(f"/api/admin/orders/{o['id']}", json={"status": "confirmed", "note": "Перезвонили", "discount": 100})
    o2 = r.json()
    assert o2["status"] == "confirmed" and float(o2["total"]) == float(o["total"]) - 100
    assert o2["events"][-1]["status"] == "confirmed" and o2["events"][-1]["note"] == "Перезвонили"

    r = await admin.get("/api/admin/orders", params={"q": "978123"})
    assert r.json()["total"] == 1 and r.json()["counts"] == {"confirmed": 1}
    await admin.patch(f"/api/admin/orders/{o['id']}", json={"status": "completed"})
    r = await admin.patch(f"/api/admin/orders/{o['id']}", json={"items": [{"sku": 11, "qty": 1}]})
    assert r.status_code == 409

    d = (await admin.get("/api/admin/dashboard")).json()
    assert d["orders"]["completed_30d"] == 1 and d["orders"]["open"] == 0
    assert (await admin.post("/api/admin/orders", json={"customer_name": "X", "phone": "12345", "items": [{"sku": 404}]})).status_code == 422


async def test_watermark_lab(admin):
    rm = default_remover()
    marked = apply_watermark(rm, synthetic_photo(800, 800), expected_detection(rm, "big", 800, 800))
    buf = io.BytesIO()
    Image.fromarray(marked).save(buf, "JPEG", quality=92)
    r = await admin.post("/api/admin/lab/watermark", files={"file": ("photo.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["detection"]["template"] == "big" and d["detection"]["verdict"] == "certain"
    assert d["detection"]["left"] < 1 and d["detection"]["left_before"] > 50
    assert d["fit"]["candidates"] and any(c["chosen"] for c in d["fit"]["candidates"])
    assert {"original", "cleaned", "crop_before", "crop_after", "mask", "diff"} <= d["images"].keys()

    clean = np.full((600, 600, 3), 240, np.uint8)
    buf = io.BytesIO()
    Image.fromarray(clean).save(buf, "PNG")
    d = (await admin.post("/api/admin/lab/watermark", files={"file": ("x.png", buf.getvalue(), "image/png")})).json()
    assert d["detection"] is None and d["candidates"]
    r = await admin.post("/api/admin/lab/watermark", files={"file": ("x.txt", b"not an image", "text/plain")})
    assert r.status_code == 422


async def test_lab_samples(admin):
    async with SessionLocal() as s:
        for i in range(12):  # 9 photos with the big mark, 3 without; products 10, 11, 12 in turn
            status = ImageStatus.stale if i == 1 else ImageStatus.ready
            s.add(ProductImage(id=500 + i, sku=10 + i % 3, source_url=f"/p/{i}.jpg", status=status, wm_template="big" if i % 4 else None))
        s.add(ProductImage(id=600, sku=10, source_url="/p/x.jpg", status=ImageStatus.pending, wm_template="big"))  # no files yet
        await s.commit()
    url = "/api/admin/lab/watermark/samples"

    groups = (await admin.get(url, params={"per_variant": 5})).json()
    assert [(g["variant"], g["total"], len(g["items"])) for g in groups] == [("big", 9, 5), ("none", 3, 3)]
    first = [x["image_id"] for x in groups[0]["items"]]
    assert first == [511, 510, 509, 507, 506]  # newest first

    rest = (await admin.get(url, params={"per_variant": 5, "variant": "big", "offset": 5})).json()
    assert [x["image_id"] for x in rest[0]["items"]] == [505, 503, 502, 501]

    # shuffled: another order, and paging through it with the same seed gives every photo once
    pages = [(await admin.get(url, params={"per_variant": 5, "variant": "big", "seed": 7, "offset": o})).json() for o in (0, 5)]
    shuffled = [x["image_id"] for page in pages for x in page[0]["items"]]
    assert sorted(shuffled) == sorted(first + [505, 503, 502, 501]) and shuffled[:5] != first

    by_name = (await admin.get(url, params={"q": "МЫШЬ"})).json()  # product 12, case-insensitive
    assert {x["sku"] for g in by_name for x in g["items"]} == {12}
    by_photo = (await admin.get(url, params={"q": "503"})).json()
    assert [x["image_id"] for g in by_photo for x in g["items"]] == [503]
    by_sku = (await admin.get(url, params={"q": "11"})).json()
    assert {x["sku"] for g in by_sku for x in g["items"]} == {11}
    assert (await admin.get(url, params={"q": "нет такого"})).json() == []
