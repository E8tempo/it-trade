"""Checkout of a client for their organization or as a private person and the orders they see: server-side prices
only (wholesale or retail), the 409s the client recovers from, the flood limit, who sees which orders, and nothing
internal shown to clients."""

import asyncio
import itertools
import json
from decimal import Decimal

import httpx
import pytest
from conftest import client_of, login, register, reset_db
from sqlalchemy import func, select, update

from app.api import orders as orders_api
from app.api.auth import _failures
from app.auth import ensure_admin
from app.db import SessionLocal
from app.models import Category, Order, Product

ORDER_KEYS = {
    "id", "number", "status", "created_at", "customer_name", "phone", "email", "delivery", "city", "address", "comment",
    "payment_method", "buyer", "items_total", "delivery_price", "discount", "total", "items", "history",
}
CONTACTS = {"customer_name": "Пётр", "phone": "+7 (978) 111-22-33", "delivery": "pickup", "payment_method": "cash"}
_clients = itertools.count(1)


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        await ensure_admin(s)
        s.add(Category(id=1, name="Периферия", slug="periferiya", path="/1/"))
        await s.flush()
        for sku, name, sp, cash, cashless, multiplicity in [(1, "Мышь", "60", "100", "105", 1), (2, "Бумага A4", "7", "10", "11", 5)]:
            s.add(Product(
                sku=sku, name=name, slug=f"p{sku}", category_id=1, search_text=name.lower(), in_stock=True, multiplicity=multiplicity,
                supplier_price=Decimal(sp), price=Decimal(cash) * 2, price_retail_cashless=Decimal(cashless) * 2,
                price_wholesale_cash=Decimal(cash), price_wholesale_cashless=Decimal(cashless),
            ))
        await s.commit()
    yield


@pytest.fixture(autouse=True)
def no_throttle():
    _failures.clear()
    orders_api._placed.clear()


@pytest.fixture
async def admin(client):
    token = await login(client, "admin@example.com", "admin-pass-123")
    client.cookies.clear()
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def buyer(client):
    c = await client_of(client, f"client{next(_clients)}@example.com")
    yield c
    await c.aclose()


async def fill(c: httpx.AsyncClient, *items: tuple[int, int]) -> dict:
    r = await c.post("/api/cart/items", json={"items": [{"sku": s, "qty": q} for s, q in items]})
    assert r.status_code == 200 and not r.json()["not_added"], r.text
    return r.json()


async def checkout(c: httpx.AsyncClient, **fields) -> httpx.Response:
    return await c.post("/api/orders", json={**CONTACTS, **fields})


async def test_a_person_orders_at_the_retail_prices(client, admin):
    r = await checkout(client)
    assert r.status_code == 401  # guests
    # registered with an organization that is not checked yet: buys as a private person
    await register(client, "person@example.com")
    await fill(client, (1, 1))
    contract = await checkout(client, contract_id=1)
    assert contract.status_code == 409 and "Договор недоступен" in contract.json()["detail"]
    r = await checkout(client, payment_method="cashless", expected_total=210.0)
    assert r.status_code == 201, r.text
    o = r.json()
    assert (o["buyer"], o["total"], [i["price"] for i in o["items"]]) == (None, 210.0, [210.0])
    assert (await client.get("/api/orders")).json()["items"][0]["buyer_name"] is None
    d = (await client.get(f"/api/admin/orders/{o['id']}", headers=admin)).json()
    assert (d["price_type"], d["organization_id"], d["buyer"], d["buyer_name"]) == ("retail_cashless", None, None, None)


async def test_order_of_a_client(buyer, admin, client):
    cart = await fill(buyer, (1, 2), (2, 5))
    assert cart["totals"]["cashless"] == 265.0
    # the client cannot set prices: the order takes the server's wholesale prices of the chosen payment method
    r = await checkout(
        buyer, payment_method="cashless", expected_total=265.0, email=" Petr@Example.com ", comment=" Позвоните заранее ",
        items=[{"sku": 1, "qty": 2, "price": 1}], price_type="retail_cash", total=1,
    )
    assert r.status_code == 201, r.text
    o = r.json()
    assert set(o) == ORDER_KEYS
    assert o["number"] == f"{o['id']:06d}" and o["status"] == "new" and o["payment_method"] == "cashless"
    assert (o["customer_name"], o["phone"], o["email"], o["comment"]) == ("Пётр", "+79781112233", "petr@example.com", "Позвоните заранее")
    assert [(i["sku"], i["name"], i["slug"], i["price"], i["qty"], i["total"]) for i in o["items"]] == [
        (1, "Мышь", "p1", 105.0, 2, 210.0), (2, "Бумага A4", "p2", 11.0, 5, 55.0),
    ]
    assert all(set(i) == {"sku", "name", "slug", "image", "price", "qty", "total"} for i in o["items"])
    assert (o["items_total"], o["delivery_price"], o["discount"], o["total"]) == (265.0, 0.0, 0.0, 265.0)
    assert o["buyer"]["name"] == cart["organization"]["name"] and o["buyer"]["contract"] is None
    assert [h["status"] for h in o["history"]] == ["new"] and set(o["history"][0]) == {"at", "status"}
    assert r.headers["cache-control"] == "no-store"

    # the cart is empty now; a second submit (a double click) places nothing
    assert (await buyer.get("/api/cart")).json()["lines"] == 0
    r = await checkout(buyer, payment_method="cashless")
    assert r.status_code == 409 and r.json()["detail"] == "Корзина пуста"

    # the order is in the admin panel, with what the client must not see
    d = (await client.get(f"/api/admin/orders/{o['id']}", headers=admin)).json()
    me = (await buyer.get("/api/auth/me")).json()
    assert (d["source"], d["price_type"], d["payment_method"], d["user_id"]) == ("site", "wholesale_cashless", "cashless", me["id"])
    assert (d["organization_id"], d["buyer_name"]) == (cart["organization"]["id"], cart["organization"]["name"])
    assert (d["cost_total"], d["margin"]) == (155.0, 110.0)  # supplier prices: 2 * 60 + 5 * 7
    assert [(e["status"], e["note"], e["author"]) for e in d["events"]] == [("new", "Заказ оформлен на сайте", "Пётр")]
    assert (me["name"], me["last_name"], me["phone"]) == ("Иван", "Петров", "+7 978 000-00-00")  # the account's own stay


async def test_checkout_refuses_carts_that_changed(buyer):
    await fill(buyer, (1, 2))
    async with SessionLocal() as s:
        await s.execute(update(Product).where(Product.sku == 1).values(in_stock=False))
        await s.commit()
    r = await checkout(buyer)
    assert r.status_code == 409 and r.json()["detail"] == "Некоторых товаров уже нет в наличии или у них нет цены. Проверьте корзину."
    async with SessionLocal() as s:
        await s.execute(update(Product).where(Product.sku == 1).values(in_stock=True, price_wholesale_cash=Decimal("99.99")))
        await s.commit()
    # the client saw 200 ₽, the price is 199.98 ₽ now
    r = await checkout(buyer, expected_total=200)
    assert r.status_code == 409 and r.json()["detail"] == "Цены изменились. Проверьте корзину."
    assert (await buyer.get("/api/cart")).json()["lines"] == 1  # nothing is taken from the cart on a 409
    r = await checkout(buyer, expected_total=199.98000001)  # compared in kopecks
    assert r.status_code == 201 and r.json()["total"] == 199.98
    async with SessionLocal() as s:
        await s.execute(update(Product).where(Product.sku == 1).values(price_wholesale_cash=Decimal(100)))
        await s.commit()


async def test_checkout_validation(buyer):
    await fill(buyer, (1, 1))
    cases = [
        ({"delivery": "courier"}, "Укажите адрес доставки"),
        ({"delivery": "courier", "address": "   "}, "Укажите адрес доставки"),
        ({"delivery": "transport", "address": "ул. Ленина, 1"}, "Укажите город доставки"),
        ({"delivery": "transport", "city": "Керчь"}, "Укажите адрес доставки"),
        ({"phone": "+ () --"}, "Проверьте номер телефона"),
    ]
    for fields, message in cases:
        r = await checkout(buyer, **fields)
        assert r.status_code == 422 and r.json()["detail"] == message, fields
    for fields in ({"customer_name": "  "}, {"phone": "123"}, {"phone": "1" * 33}, {"email": "not-an-email"}, {"comment": "x" * 2001},
                   {"city": "x" * 129}, {"address": "x" * 513}, {"delivery": "drone"}, {"payment_method": "crypto"},
                   {"expected_total": -1}, {"expected_total": 1e12}, {"payment_method": None}, {"contract_id": 0}):
        assert (await checkout(buyer, **fields)).status_code == 422, fields
    assert (await buyer.post("/api/orders", json={k: v for k, v in CONTACTS.items() if k != "delivery"})).status_code == 422

    r = await checkout(buyer, delivery="transport", city=" Керчь ", address="ТК «Деловые линии», ул. Портовая, 1", email="")
    assert r.status_code == 201 and (r.json()["city"], r.json()["email"]) == ("Керчь", None)
    await fill(buyer, (1, 1))
    r = await checkout(buyer, delivery="pickup", city="Керчь", address="ул. Ленина, 1")  # left from another delivery choice
    assert r.status_code == 201 and (r.json()["city"], r.json()["address"]) == (None, None)


async def test_too_many_orders_from_one_address(buyer, monkeypatch):
    monkeypatch.setattr(orders_api, "MAX_ORDERS", 2)
    for _ in range(2):
        await fill(buyer, (1, 1))
        assert (await checkout(buyer)).status_code == 201
    await fill(buyer, (1, 1))
    r = await checkout(buyer)
    assert r.status_code == 429 and r.json()["detail"] == "Слишком много заказов, попробуйте позже"
    assert (await buyer.get("/api/cart")).json()["lines"] == 1


async def test_double_submit_places_one_order(buyer):
    await fill(buyer, (1, 1))
    async with SessionLocal() as s:
        before = await s.scalar(select(func.count()).select_from(Order))
    first, second = await asyncio.gather(checkout(buyer), checkout(buyer))
    assert sorted((first.status_code, second.status_code)) == [201, 409]
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(Order)) == before + 1


async def test_who_sees_which_orders(client, admin):
    head = await client_of(client, "head@example.com")
    org_id = (await head.get("/api/cart")).json()["organization"]["id"]
    # a purchaser of the same company registers (with the company's branch) and the manager adds them to it
    worker = httpx.AsyncClient(transport=client._transport, base_url="http://test")
    await register(worker, "worker@example.com")
    r = await client.post(f"/api/admin/organizations/{org_id}/members", json={"email": "worker@example.com", "role": "buyer"}, headers=admin)
    assert r.status_code == 201, r.text
    assert (await worker.get("/api/cart")).json()["organization"]["id"] == org_id  # its only approved organization

    await fill(head, (1, 1))
    by_head = (await checkout(head, customer_name="Руководитель")).json()
    await fill(worker, (2, 5))
    by_worker = (await checkout(worker, customer_name="Закупщик", payment_method="cashless")).json()

    page = (await head.get("/api/orders")).json()  # the head sees every order of the organization
    assert [o["id"] for o in page["items"]] == [by_worker["id"], by_head["id"]]
    assert page["items"][0] == {
        "id": by_worker["id"], "number": by_worker["number"], "status": "new", "created_at": by_worker["created_at"], "total": 55.0,
        "items_count": 5, "payment_method": "cashless", "buyer_name": by_worker["buyer"]["name"],
    }
    assert (await head.get(f"/api/orders/{by_worker['id']}")).status_code == 200
    assert page["counts"] == {"open": 2, "completed": 0, "cancelled": 0}
    assert [o["id"] for o in (await worker.get("/api/orders")).json()["items"]] == [by_worker["id"]]  # a purchaser: their own
    r = await worker.get(f"/api/orders/{by_head['id']}")
    assert r.status_code == 404 and r.json()["detail"] == "Заказ не найден"
    assert [o["id"] for o in (await head.get("/api/orders", params={"per_page": 1, "page": 2})).json()["items"]] == [by_head["id"]]
    assert (await head.get("/api/orders", params={"per_page": 51})).status_code == 422

    # the manager works on it: the client sees the status, not the notes or who made them
    await client.patch(
        f"/api/admin/orders/{by_head['id']}",
        json={"status": "confirmed", "note": "Клиент просил не звонить после 18:00", "manager_note": "Маржа маленькая"},
        headers=admin,
    )
    def by_state(st: str):
        return head.get("/api/orders", params={"state": st})

    assert [o["id"] for o in (await by_state("open")).json()["items"]] == [by_worker["id"], by_head["id"]]
    await client.patch(f"/api/admin/orders/{by_worker['id']}", json={"status": "cancelled"}, headers=admin)
    page = (await by_state("cancelled")).json()
    assert ([o["id"] for o in page["items"]], page["counts"]) == ([by_worker["id"]], {"open": 1, "completed": 0, "cancelled": 1})
    assert [o["id"] for o in (await by_state("open")).json()["items"]] == [by_head["id"]]
    assert (await by_state("lost")).status_code == 422
    r = await head.get(f"/api/orders/{by_head['id']}")
    d = r.json()
    assert r.status_code == 200 and set(d) == ORDER_KEYS and r.headers["cache-control"] == "no-store"
    assert [h["status"] for h in d["history"]] == ["new", "confirmed"] and d["status"] == "confirmed"
    text = json.dumps(d, ensure_ascii=False)
    for secret in ("supplier_price", "cost_total", "margin", "manager_note", "Маржа", "18:00", "Администратор", "note", "author"):
        assert secret not in text

    # outsiders and guests see none of it
    other = await client_of(client, "outsider@example.com")
    assert (await other.get("/api/orders")).json()["items"] == []
    assert (await other.get(f"/api/orders/{by_head['id']}")).status_code == 404
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as guest:
        assert (await guest.get("/api/orders")).status_code == 401
    assert (await head.get(f"/api/orders/{2**31}")).status_code == 422
    for c in (head, worker, other):
        await c.aclose()
