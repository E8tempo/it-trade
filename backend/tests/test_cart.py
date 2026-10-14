"""The cart of a client: only for people of an approved organization, at its wholesale prices; quantities, products
that cannot be ordered, totals of both payment methods."""

import itertools
from decimal import Decimal

import httpx
import pytest
from conftest import approve, client_of, register, reset_db
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.api import cart as cart_api
from app.api.auth import _failures
from app.db import SessionLocal
from app.models import Cart, Category, Product, ProductImage
from app.models.catalog import ImageStatus

# sku: (name, wholesale cash, wholesale cashless, multiplicity, product fields); retail prices are never used
PRODUCTS = {
    1: ("Мышь", "100", "105", 1, {}),
    2: ("Бумага A4", "10", "11", 5, {}),  # sold in packs of 5
    3: ("Монитор", "50", "52", 1, {"in_stock": False}),
    4: ("Скрытый", "70", "72", 1, {"is_hidden": True}),
    5: ("Снят с продажи", "80", "82", 1, {"is_active": False}),
    6: ("Без цены", None, None, 1, {}),
    7: ("Только за наличные", "200", None, 1, {}),
}
_buyers = itertools.count(1)


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        s.add(Category(id=1, name="Периферия", slug="periferiya", path="/1/"))
        await s.flush()
        for sku, (name, cash, cashless, multiplicity, fields) in PRODUCTS.items():
            s.add(Product(
                sku=sku, name=name, slug=f"p{sku}", vendor="HP", part=f"P-{sku}", category_id=1, search_text=name.lower(),
                multiplicity=multiplicity, qty_central=3, qty_nearest=2, **{"in_stock": True, **fields},
                price=Decimal(999), price_retail_cashless=Decimal(999),
                price_wholesale_cash=cash and Decimal(cash), price_wholesale_cashless=cashless and Decimal(cashless),
            ))
        await s.flush()
        s.add(ProductImage(id=900, sku=1, source_url="1.jpg", status=ImageStatus.ready))
        await s.flush()
        (await s.get(Product, 1)).main_image_id = 900
        await s.commit()
    yield


@pytest.fixture(autouse=True)
def no_throttle():
    _failures.clear()


@pytest.fixture
async def buyer(client):
    """A client of an approved organization, with a browser of their own."""
    c = await client_of(client, f"buyer{next(_buyers)}@example.com")
    yield c
    await c.aclose()


async def set_product(sku: int, **fields) -> None:
    async with SessionLocal() as s:
        await s.execute(update(Product).where(Product.sku == sku).values(**fields))
        await s.commit()


async def cart_rows(user_id: int) -> list[tuple[int, int]] | None:
    async with SessionLocal() as s:
        cart = await s.scalar(select(Cart).where(Cart.user_id == user_id).options(selectinload(Cart.items)))
        return [(i.sku, i.qty) for i in cart.items] if cart else None


async def add(c: httpx.AsyncClient, *items: tuple[int, int], payment: str = "cash") -> dict:
    r = await c.post("/api/cart/items", params={"payment": payment}, json={"items": [{"sku": s, "qty": q} for s, q in items]})
    assert r.status_code == 200, r.text
    return r.json()


def lines(cart: dict) -> list[tuple[int, int]]:
    return [(i["sku"], i["qty"]) for i in cart["items"]]


async def test_only_clients_of_an_approved_organization_have_a_cart(client):
    # guests: no cart, no prices (the site sells to businesses only)
    for r in (await client.get("/api/cart"), await client.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 1}]}),
              await client.get("/api/cart/prices", params={"sku": 1})):
        assert r.status_code == 401
    # registered, the organization not checked yet
    await register(client, "new@example.com")
    for r in (await client.get("/api/cart"), await client.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 1}]}),
              await client.get("/api/cart/prices", params={"sku": 1})):
        assert r.status_code == 403 and r.json()["detail"] == cart_api.NO_PRICES
    org_id = await approve("new@example.com")

    r = await client.get("/api/cart")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json() == {
        "audience": "wholesale", "organization": {"id": org_id, "name": "ООО «new»", "inn": r.json()["organization"]["inn"]},
        "payment": "cash", "price_type": "wholesale_cash", "items": [], "lines": 0, "units": 0, "total": 0.0,
        "totals": {"cash": 0.0, "cashless": 0.0}, "can_checkout": False, "not_added": [],
    }
    me = (await client.get("/api/auth/me")).json()["id"]
    assert await cart_rows(me) is None  # reads never create a cart
    for r in (await client.delete("/api/cart"), await client.delete("/api/cart/items/1"), await client.put("/api/cart/items/1", json={"qty": 0})):
        assert r.status_code == 200 and r.json()["lines"] == 0
    assert (await client.post("/api/cart/items", json={"items": [{"sku": 3, "qty": 1}]})).json()["not_added"] == [{"sku": 3, "reason": "out_of_stock"}]
    assert await cart_rows(me) is None
    assert (await client.get("/api/cart", params={"payment": "card"})).status_code == 422

    # the first change creates it, at the organization's wholesale prices
    r = await client.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 2}]})
    (line,) = r.json()["items"]
    assert line == {
        "sku": 1, "name": "Мышь", "slug": "p1", "vendor": "HP", "part": "P-1", "image": line["image"], "qty": 2, "multiplicity": 1,
        "stock": 5, "in_stock": True, "price": 100.0, "prices": {"cash": 100.0, "cashless": 105.0}, "total": 200.0, "problem": None,
    }
    assert line["image"]["id"] == 900 and line["image"]["urls"]["md"].startswith("/media/products/900/900_md.webp")
    assert lines(await add(client, (1, 1))) == [(1, 3)]
    cart = (await client.get("/api/cart", params={"payment": "cashless"})).json()
    assert (cart["price_type"], cart["items"][0]["price"], cart["items"][0]["total"]) == ("wholesale_cashless", 105.0, 315.0)
    assert (cart["total"], cart["totals"], cart["lines"], cart["units"], cart["can_checkout"]) == (315.0, {"cash": 300.0, "cashless": 315.0}, 1, 3, True)
    assert await cart_rows(me) == [(1, 3)]
    # the catalog's prices for the organization; products not sold are left out
    r = await client.get("/api/cart/prices", params=[("sku", 1), ("sku", 4), ("sku", 999)])
    assert r.json() == {"audience": "wholesale", "prices": {"1": {"cash": 100.0, "cashless": 105.0}}}


async def test_quantities_are_rounded_to_whole_packs(buyer):
    assert lines(await add(buyer, (2, 3))) == [(2, 5)]  # at least one pack of 5
    assert lines(await add(buyer, (2, 1))) == [(2, 10)]  # 5 + 1 -> 10
    assert lines((await buyer.put("/api/cart/items/2", json={"qty": 11})).json()) == [(2, 15)]
    assert lines((await buyer.put("/api/cart/items/2", json={"qty": 99_999})).json()) == [(2, 99_995)]  # the last whole pack
    assert lines(await add(buyer, (2, 99_999))) == [(2, 99_995)]
    assert lines(await add(buyer, (1, 2), (1, 3))) == [(2, 99_995), (1, 5)]  # the same product twice in one request
    for bad in ({"items": []}, {"items": [{"sku": 1, "qty": 0}]}, {"items": [{"sku": 1, "qty": 100_000}]},
                {"items": [{"sku": 1, "qty": 1}] * 501}, {"items": [{"sku": 2**31, "qty": 1}]}):
        assert (await buyer.post("/api/cart/items", json=bad)).status_code == 422
    assert (await buyer.put("/api/cart/items/1", json={"qty": 100_000})).status_code == 422
    assert (await buyer.put("/api/cart/items/1", json={"qty": -1})).status_code == 422
    assert (await buyer.put(f"/api/cart/items/{2**31}", json={"qty": 1})).status_code == 422


async def test_products_that_cannot_be_ordered(buyer):
    cart = await add(buyer, (1, 1), (3, 1), (4, 1), (5, 1), (6, 1), (999, 1))
    assert lines(cart) == [(1, 1)]
    assert cart["not_added"] == [
        {"sku": 3, "reason": "out_of_stock"},
        {"sku": 4, "reason": "not_found"},  # hidden by admin
        {"sku": 5, "reason": "not_found"},  # left the supplier catalog
        {"sku": 6, "reason": "no_price"},
        {"sku": 999, "reason": "not_found"},
    ]
    assert (await buyer.get("/api/cart")).json()["not_added"] == []  # only the answer to the POST
    for sku, text in ((3, "Товара нет в наличии"), (4, "Товар не найден или больше не продаётся"), (6, "У товара нет цены")):
        r = await buyer.put(f"/api/cart/items/{sku}", json={"qty": 1})
        assert r.status_code == 422 and r.json()["detail"] == text

    # a product priced for cash only: added when paying cash, a problem when paying cashless
    assert lines(await add(buyer, (7, 2))) == [(1, 1), (7, 2)]
    r = await buyer.post("/api/cart/items", params={"payment": "cashless"}, json={"items": [{"sku": 7, "qty": 1}]})
    assert r.json()["not_added"] == [{"sku": 7, "reason": "no_price"}]
    cash = (await buyer.get("/api/cart")).json()
    cashless = (await buyer.get("/api/cart", params={"payment": "cashless"})).json()
    assert (cash["total"], cash["can_checkout"]) == (500.0, True)
    assert (cashless["total"], cashless["can_checkout"], cashless["items"][1]["problem"]) == (105.0, False, "no_price")
    assert cash["totals"] == cashless["totals"] == {"cash": 500.0, "cashless": 105.0}

    # products change after they were added: the lines stay, with the problem, and are not counted
    await set_product(1, in_stock=False)
    cart = (await buyer.get("/api/cart")).json()
    assert [(i["sku"], i["problem"], i["price"]) for i in cart["items"]] == [(1, "out_of_stock", 100.0), (7, None, 200.0)]
    assert (cart["total"], cart["can_checkout"], cart["lines"], cart["units"]) == (400.0, False, 2, 3)
    await set_product(1, in_stock=True, is_hidden=True)
    line = (await buyer.get("/api/cart")).json()["items"][0]
    assert (line["problem"], line["price"], line["prices"], line["total"]) == ("not_found", None, {"cash": None, "cashless": None}, None)
    await set_product(1, is_hidden=False)
    assert (await buyer.get("/api/cart")).json()["can_checkout"] is True
    # a line can still be removed
    assert lines((await buyer.put("/api/cart/items/7", json={"qty": 0})).json()) == [(1, 1)]


async def test_setting_removing_and_clearing(buyer):
    assert lines((await buyer.put("/api/cart/items/1", json={"qty": 4})).json()) == [(1, 4)]  # PUT creates the line
    assert lines((await buyer.put("/api/cart/items/1", json={"qty": 2})).json()) == [(1, 2)]
    await add(buyer, (2, 5))
    assert lines((await buyer.delete("/api/cart/items/1")).json()) == [(2, 5)]
    assert lines((await buyer.delete("/api/cart/items/1")).json()) == [(2, 5)]  # not in the cart: nothing happens
    r = await buyer.delete("/api/cart")
    assert r.json()["items"] == [] and r.json()["can_checkout"] is False
    me = (await buyer.get("/api/auth/me")).json()["id"]
    assert await cart_rows(me) == []  # the cart itself stays
    assert lines(await add(buyer, (1, 1))) == [(1, 1)]


async def test_at_most_max_lines(buyer, monkeypatch):
    monkeypatch.setattr(cart_api, "MAX_LINES", 2)
    await add(buyer, (1, 1), (2, 5))
    r = await buyer.post("/api/cart/items", json={"items": [{"sku": 7, "qty": 1}]})
    assert r.status_code == 409 and r.json()["detail"] == "В корзине не больше 2 позиций"
    assert (await buyer.put("/api/cart/items/7", json={"qty": 1})).status_code == 409
    assert lines(await add(buyer, (1, 1))) == [(1, 2), (2, 5)]  # more of a product already in the cart is fine


async def test_signed_in_browser_with_an_expired_session_gets_401(buyer):
    await add(buyer, (1, 2))
    del buyer.cookies["access_token"]  # the browser dropped it: only the refresh token is left
    assert (await buyer.get("/api/cart")).status_code == 401  # the client refreshes the session and repeats the request
    assert (await buyer.post("/api/cart/items", json={"items": [{"sku": 2, "qty": 5}]})).status_code == 401
    assert (await buyer.post("/api/auth/refresh")).status_code == 200
    assert lines((await buyer.get("/api/cart")).json()) == [(1, 2)]
