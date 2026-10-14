"""Supplier markup rules per price type, fixed prices per type, and admin orders with a payment method and
an audience (whose prices the lines take)."""

from decimal import Decimal

import pytest
from conftest import login, reset_db
from sqlalchemy import select

from app.auth import ensure_admin
from app.db import SessionLocal
from app.models import Category, PriceType, Product, SiteSetting
from app.sync.stock import apply_stock

DEFAULT_RULES = {"markup_percent": "20", "category_markups": {}, "min_markup": "0", "round_to": 10, "use_rrp": True}


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
        for sku, cat, rrp in [(20, 2, None), (21, 2, Decimal(3000)), (22, 1, None), (23, 1, None)]:
            s.add(Product(sku=sku, name=f"Товар {sku}", slug=f"p{sku}", category_id=cat, rrp=rrp, search_text=f"товар {sku}"))
        await s.commit()
    # 23 is not in stock: no supplier price, no prices
    await apply_stock([{"sku": 20, "price": 1000, "real_qty": 1}, {"sku": 21, "price": 2000, "real_qty": 1}, {"sku": 22, "price": 500, "real_qty": 1}])
    yield


@pytest.fixture
async def admin(client):
    token = await login(client, "admin@example.com", "admin-pass-123")
    client.cookies.clear()
    client.headers["Authorization"] = f"Bearer {token}"
    return client


async def prices(admin, sku: int) -> dict:
    r = await admin.get("/api/admin/products", params={"q": f"товар {sku}"})
    return next(p for p in r.json()["items"] if p["sku"] == sku)["prices"]


async def test_suppliers_and_their_default_rules(admin):
    r = await admin.get("/api/admin/suppliers")
    assert r.json() == [{"code": "itp", "name": "IT Partner", "url": "https://b2b.i-t-p.pro", "products": 4, "in_stock": 3}]
    r = await admin.get("/api/admin/suppliers/itp/pricing")
    assert r.json() == dict.fromkeys(PriceType, DEFAULT_RULES)  # nothing saved yet: the defaults for every type
    # the defaults price every type alike
    assert await prices(admin, 21) == dict.fromkeys(PriceType, 3000)  # the RRP
    assert await prices(admin, 20) == dict.fromkeys(PriceType, 1200)
    assert await prices(admin, 23) == dict.fromkeys(PriceType)  # no supplier price, no prices

    assert (await admin.get("/api/admin/suppliers/nope/pricing")).status_code == 404
    assert (await admin.put("/api/admin/suppliers/nope/pricing/retail_cash", json=DEFAULT_RULES)).status_code == 404
    assert (await admin.put("/api/admin/suppliers/itp/pricing/vip", json=DEFAULT_RULES)).status_code == 422
    preview = {"supplier": "nope", "supplier_price": 100}
    assert (await admin.post("/api/admin/pricing/preview", json=preview)).status_code == 404
    impact = {"supplier": "nope", "settings": DEFAULT_RULES}
    assert (await admin.post("/api/admin/pricing/impact", json=impact)).status_code == 404

    # validation errors have the shape of the settings sections: field, message, no echoed input
    r = await admin.put("/api/admin/suppliers/itp/pricing/retail_cash", json={**DEFAULT_RULES, "markup_percent": -1})
    assert r.status_code == 422
    (err,) = r.json()["detail"]
    assert err["loc"] == ["markup_percent"] and "input" not in err and "url" not in err


async def test_saving_the_rules_of_a_type_reprices_that_type(admin, client):
    rules = {"markup_percent": 5, "min_markup": 100, "round_to": 1, "use_rrp": False, "category_markups": {"1": 8}}
    r = await admin.put("/api/admin/suppliers/itp/pricing/wholesale_cash", json=rules)
    assert r.status_code == 200
    saved = {**DEFAULT_RULES, "markup_percent": "5", "min_markup": "100", "round_to": 1, "use_rrp": False, "category_markups": {"1": "8"}}
    assert r.json() == {**dict.fromkeys(PriceType, DEFAULT_RULES), "wholesale_cash": saved}
    assert (await admin.get("/api/admin/suppliers/itp/pricing")).json() == r.json()
    async with SessionLocal() as s:
        assert {row.key for row in await s.scalars(select(SiteSetting))} == {"pricing:itp"}

    # repriced in the background: the category markup 8% of /1/ is inherited by /1/2/, the RRP is not used
    assert await prices(admin, 20) == {"retail_cash": 1200, "retail_cashless": 1200, "wholesale_cash": 1100, "wholesale_cashless": 1200}
    assert await prices(admin, 21) == {"retail_cash": 3000, "retail_cashless": 3000, "wholesale_cash": 2160, "wholesale_cashless": 3000}
    assert (await db_price(21))[1] == Decimal(3000)


async def test_preview_prices_every_type(admin):
    tried = {"markup_percent": 50, "round_to": 1, "use_rrp": False}
    r = await admin.post(
        "/api/admin/pricing/preview",
        json={"price_type": "retail_cashless", "settings": tried, "supplier_price": 1000, "category_id": 2},
    )
    d = r.json()
    assert r.status_code == 200 and d["price"] == 1500 and d["markup_percent"] == 50
    # the tried rules for retail cashless, the saved ones for the others
    assert d["by_type"] == {"retail_cash": 1200, "retail_cashless": 1500, "wholesale_cash": 1100, "wholesale_cashless": 1200}
    # without rules to try: the saved ones of the type
    r = await admin.post("/api/admin/pricing/preview", json={"price_type": "wholesale_cash", "supplier_price": 1000, "category_id": 2})
    assert r.json()["price"] == 1100 and r.json()["markup_category"]["id"] == 1 and r.json()["margin"] == 100


async def test_impact_counts_wholesale_prices_above_retail(admin):
    url = "/api/admin/pricing/impact"
    rules = {"markup_percent": 30, "round_to": 1, "use_rrp": False}
    # wholesale cash +30%: 20 -> 1300 (retail cash 1200: above), 21 -> 2600 (retail 3000), 22 -> 650 (retail 600: above)
    d = (await admin.post(url, json={"price_type": "wholesale_cash", "settings": rules})).json()
    assert (d["products"], d["changed"], d["up"], d["down"], d["above_retail"]) == (3, 3, 3, 0, 2)
    assert d["examples"][0] == {"sku": 21, "name": "Товар 21", "supplier_price": 2000, "before": 2160, "after": 2600}
    # compared with the retail price of the same payment method
    await admin.put("/api/admin/suppliers/itp/pricing/retail_cashless", json={"markup_percent": 40, "round_to": 1, "use_rrp": False})
    d = (await admin.post(url, json={"price_type": "wholesale_cashless", "settings": rules})).json()
    assert d["above_retail"] == 0  # retail cashless is +40% now
    assert (await admin.post(url, json={"price_type": "retail_cashless", "settings": rules})).json()["above_retail"] is None

    # a product whose price of the type is fixed is left out
    await admin.patch("/api/admin/products/22", json={"price_overrides": {"wholesale_cash": 555}})
    d = (await admin.post(url, json={"price_type": "wholesale_cash", "settings": rules})).json()
    assert (d["products"], d["above_retail"]) == (2, 1)
    d = (await admin.post(url, json={"price_type": "wholesale_cashless", "settings": rules})).json()
    assert d["products"] == 3  # fixed for wholesale cash only
    await admin.patch("/api/admin/products/22", json={"price_overrides": {"wholesale_cash": None}})


async def test_fixed_prices_per_type(admin, client):
    url = "/api/admin/products/20"
    before = await prices(admin, 20)
    r = await admin.patch(url, json={"price_overrides": {"wholesale_cashless": 999, "retail_cashless": 1234.5}})
    p = r.json()
    assert p["price_overrides"] == {"wholesale_cashless": 999, "retail_cashless": 1234.5}
    assert p["prices"] == {**before, "wholesale_cashless": 999, "retail_cashless": 1234.5}
    assert (await db_price(20))[1] == Decimal("1234.5")

    # the fixed types survive repricing and stock updates, the others follow the rules and the supplier price
    await admin.put("/api/admin/suppliers/itp/pricing/wholesale_cashless", json={"markup_percent": 1, "round_to": 1, "use_rrp": False})
    await apply_stock([{"sku": 20, "price": 2000, "real_qty": 1}, {"sku": 21, "price": 2000, "real_qty": 1}, {"sku": 22, "price": 500, "real_qty": 1}])
    assert await prices(admin, 20) == {"retail_cash": 2400, "retail_cashless": 1234.5, "wholesale_cash": 2160, "wholesale_cashless": 999}
    assert (await prices(admin, 21))["wholesale_cashless"] == 2020

    # a merge: types not sent stay as they are; `null` returns a type to the rules; `price_overrides: null` changes nothing
    r = await admin.patch(url, json={"price_overrides": {"retail_cashless": None}})
    assert r.json()["price_overrides"] == {"wholesale_cashless": 999} and r.json()["prices"]["retail_cashless"] == 2800
    assert (await admin.patch(url, json={"price_overrides": None})).json()["price_overrides"] == {"wholesale_cashless": 999}

    # the filter and the dashboard count products with any fixed price
    assert [p["sku"] for p in (await admin.get("/api/admin/products", params={"override": True})).json()["items"]] == [20]
    assert {p["sku"] for p in (await admin.get("/api/admin/products", params={"override": False})).json()["items"]} == {21, 22, 23}
    assert (await admin.get("/api/admin/dashboard")).json()["products"]["fixed_price"] == 1

    for bad in ({"retail_cash": 0}, {"retail_cash": -5}, {"retail_cash": 10.123}, {"vip": 10}, {"retail_cash": "много"}):
        assert (await admin.patch(url, json={"price_overrides": bad})).status_code == 422, bad
    assert (await admin.patch(url, json={"price_override": 100})).json()["price_overrides"] == {"wholesale_cashless": 999}

    r = await admin.patch(url, json={"price_overrides": {"wholesale_cashless": None}})
    assert r.json()["price_overrides"] == {} and r.json()["prices"]["wholesale_cashless"] == 2020
    async with SessionLocal() as s:  # no fixed prices left: SQL NULL, not an empty object
        assert await s.scalar(select(Product.sku).where(Product.sku == 20, Product.price_overrides.is_(None))) == 20
    assert (await admin.get("/api/admin/products", params={"override": True})).json()["total"] == 0
    assert (await admin.get("/api/admin/dashboard")).json()["products"]["fixed_price"] == 0


async def test_categories_have_no_markup_field(admin):
    cats = (await admin.get("/api/admin/categories")).json()
    assert [c["id"] for c in cats] == [1, 2] and all("markup" not in c for c in cats)
    assert "markup" not in (await admin.patch("/api/admin/categories/2", json={"is_hidden": False})).json()


async def test_admin_order_with_payment_method_and_audience(admin):
    p20 = await prices(admin, 20)
    r = await admin.post(
        "/api/admin/orders",
        json={
            "customer_name": "ООО Ромашка",
            "phone": "+7 978 000-00-01",
            "payment_method": "cashless",
            "audience": "wholesale",
            "items": [{"sku": 20, "qty": 2}, {"sku": 22, "qty": 1, "price": 450}],
        },
    )
    assert r.status_code == 201, r.text
    o = r.json()
    assert (o["payment_method"], o["price_type"], o["user_id"]) == ("cashless", "wholesale_cashless", None)
    assert [i["price"] for i in o["items"]] == [p20["wholesale_cashless"], 450]
    assert o["items_total"] == 2 * p20["wholesale_cashless"] + 450

    # retail prices from now on: the lines keep their prices (snapshots), the history tells about the change
    r = await admin.patch(f"/api/admin/orders/{o['id']}", json={"audience": "retail"})
    o2 = r.json()
    assert (o2["payment_method"], o2["price_type"]) == ("cashless", "retail_cashless")
    assert [i["price"] for i in o2["items"]] == [p20["wholesale_cashless"], 450] and o2["total"] == o["total"]
    assert o2["events"][-1]["note"] == "Цены: опт → розница" and o2["events"][-1]["status"] is None

    # lines sent without a price take the price of the new type
    r = await admin.patch(
        f"/api/admin/orders/{o['id']}", json={"payment_method": "cash", "items": [{"sku": 20, "qty": 1}, {"sku": 22, "qty": 1, "price": 450}]}
    )
    o3 = r.json()
    assert o3["price_type"] == "retail_cash" and [i["price"] for i in o3["items"]] == [p20["retail_cash"], 450]
    assert o3["events"][-1]["note"] == "Оплата: безналичный расчёт → наличные; состав заказа изменён"

    # nothing changes, nothing is written to the history
    r = await admin.patch(f"/api/admin/orders/{o['id']}", json={"payment_method": "cash", "audience": "retail"})
    assert len(r.json()["events"]) == len(o3["events"])
    listed = (await admin.get("/api/admin/orders")).json()["items"][0]
    assert (listed["payment_method"], listed["price_type"], listed["user_id"]) == ("cash", "retail_cash", None)
    assert (await admin.patch(f"/api/admin/orders/{o['id']}", json={"audience": "vip"})).status_code == 422
