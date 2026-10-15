"""Commercial offers: made from the cart or the catalog, priced by the client's markup over what they pay us, the RRP
or a price typed in; the costs stay as they were until refreshed; seen by their author and the organization's head."""

import itertools
from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
from conftest import approve, client_of, register, reset_db
from sqlalchemy import select, update

from app.api.auth import _failures
from app.db import SessionLocal
from app.models import Category, OrganizationMember, Product, User

# sku: (name, wholesale cash, wholesale cashless, rrp, product fields)
PRODUCTS = {
    1: ("Мышь", "100", "104", "150", {}),
    2: ("Клавиатура", "333", "340", None, {}),
    3: ("Монитор", "5000", "5100", "7000", {"in_stock": False}),
    4: ("Скрытый", "70", "72", None, {"is_hidden": True}),
    5: ("Без цены", None, None, None, {}),
}
_people = itertools.count(1)


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        s.add(Category(id=1, name="Периферия", slug="periferiya", path="/1/"))
        await s.flush()
        for sku, (name, cash, cashless, rrp, fields) in PRODUCTS.items():
            s.add(Product(
                sku=sku, name=name, slug=f"p{sku}", vendor="Logitech", part=f"LG-{sku}", category_id=1, search_text=name.lower(),
                qty_central=3, qty_nearest=2, **{"in_stock": True, **fields}, rrp=rrp and Decimal(rrp),
                price=Decimal(999), price_retail_cashless=Decimal(999),
                price_wholesale_cash=cash and Decimal(cash), price_wholesale_cashless=cashless and Decimal(cashless),
            ))
        await s.commit()
    yield


@pytest.fixture(autouse=True)
def no_throttle():
    _failures.clear()


@pytest.fixture
async def seller(client):
    """A client of an approved organization (its head), with a browser of their own."""
    c = await client_of(client, f"seller{next(_people)}@example.com")
    yield c
    await c.aclose()


async def new_quote(c: httpx.AsyncClient, **body) -> dict:
    r = await c.post("/api/quotes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def add(c: httpx.AsyncClient, qid: int, *lines: dict) -> dict:
    r = await c.post(f"/api/quotes/{qid}/items", json={"items": list(lines)})
    assert r.status_code == 200, r.text
    return r.json()


async def patch(c: httpx.AsyncClient, qid: int, **body) -> dict:
    r = await c.patch(f"/api/quotes/{qid}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def patch_line(c: httpx.AsyncClient, qid: int, item_id: int, **body) -> dict:
    r = await c.patch(f"/api/quotes/{qid}/items/{item_id}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def line(q: dict, sku: int | None = None, name: str | None = None) -> dict:
    return next(i for i in q["items"] if (sku is not None and i["sku"] == sku) or (name is not None and i["name"] == name))


async def test_only_for_an_approved_organization(client):
    assert (await client.post("/api/quotes", json={})).status_code == 401
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as c:
        await register(c, "pending-quotes@example.com")
        r = await c.post("/api/quotes", json={})
        assert r.status_code == 403
        assert (await c.get("/api/quotes")).json()["total"] == 0


async def test_numbers_and_defaults(seller):
    a = await new_quote(seller, title="Офис", customer="ООО «Заказчик»")
    b = await new_quote(seller)
    assert (a["number"], b["number"]) == (1, 2)
    assert a["title"] == "Офис" and a["customer"] == "ООО «Заказчик»"
    assert a["payment"] == "cashless" and a["markup_percent"] == 20 and a["vat_rate"] is None
    assert a["valid_until"] == (date.today() + timedelta(days=10)).isoformat()
    assert a["items"] == [] and a["totals"]["total"] == 0
    assert a["seller"]["name"].startswith("ООО") and a["seller"]["author_email"].startswith("seller")


async def test_from_the_cart(seller):
    r = await seller.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 2}, {"sku": 2, "qty": 1}]})
    assert r.status_code == 200, r.text
    q = await new_quote(seller, from_cart=True, payment="cash")
    assert [(i["sku"], i["qty"], i["cost"]) for i in q["items"]] == [(1, 2, 100), (2, 1, 333)]
    # the cart stays as it was
    assert len((await seller.get("/api/cart")).json()["items"]) == 2


async def test_from_an_empty_cart(seller):
    assert (await seller.post("/api/quotes", json={"from_cart": True})).status_code == 409


async def test_selling_prices(seller):
    q = await new_quote(seller)
    q = await add(seller, q["id"], {"sku": 1, "qty": 2}, {"sku": 2, "qty": 3})
    mouse, keyboard = line(q, 1), line(q, 2)
    # 20 % over the cashless wholesale price, rounded up to whole roubles
    assert (mouse["cost"], mouse["sale_price"], mouse["price_source"], mouse["total"]) == (104, 125, "markup", 250)
    assert (keyboard["cost"], keyboard["sale_price"]) == (340, 408)
    assert mouse["part"] == "LG-1" and mouse["vendor"] == "Logitech" and mouse["slug"] == "p1"
    assert q["totals"] == {"total": 250 + 1224, "cost": 208 + 1020, "profit": 246, "vat": None, "units": 5, "unpriced": 0, "changed": 0, "problems": 0}

    # rounding to tens, a markup of its own on a line, a price typed in on another
    q = await patch(seller, q["id"], round_to=10, markup_percent=30)
    assert line(q, 1)["sale_price"] == 140  # 135.2 -> 140
    q = await patch_line(seller, q["id"], line(q, 1)["id"], markup_percent=50)
    assert line(q, 1)["sale_price"] == 160 and line(q, 1)["markup_percent"] == 50  # 156 -> 160
    q = await patch_line(seller, q["id"], line(q, 2)["id"], price="399.99")
    assert (line(q, 2)["sale_price"], line(q, 2)["price_source"], line(q, 2)["profit"]) == (399.99, "fixed", round((399.99 - 340) * 3, 2))
    q = await patch_line(seller, q["id"], line(q, 2)["id"], price=None, markup_percent=None)
    assert line(q, 2)["sale_price"] == 450  # 442 -> 450, the offer's 30 %

    # the RRP where there is one, the markup elsewhere; VAT inside the total
    q = await patch(seller, q["id"], use_rrp=True, vat_rate=22)
    assert (line(q, 1)["sale_price"], line(q, 1)["price_source"]) == (150, "rrp")
    assert line(q, 2)["price_source"] == "markup"
    total = 150 * 2 + 450 * 3
    assert q["totals"]["total"] == total and q["totals"]["vat"] == round(total * 22 / 122, 2)

    # kopecks
    q = await patch(seller, q["id"], use_rrp=False, round_to=0, markup_percent="12.5")
    assert line(q, 2)["sale_price"] == 382.5


async def test_own_lines_and_products_not_sold(seller):
    q = await new_quote(seller)
    q = await add(seller, q["id"], {"name": "Монтаж", "price": "1500", "qty": 2, "unit": "усл."}, {"sku": 3}, {"sku": 5})
    own = line(q, name="Монтаж")
    assert (own["sku"], own["unit"], own["cost"], own["sale_price"], own["total"]) == (None, "усл.", None, 1500, 3000)
    assert line(q, 3)["problem"] == "out_of_stock" and line(q, 3)["sale_price"] == 6120
    assert line(q, 5)["problem"] == "no_price" and line(q, 5)["sale_price"] is None
    t = q["totals"]
    assert (t["total"], t["cost"], t["profit"], t["unpriced"], t["problems"]) == (9120, 5100, 4020, 1, 2)

    # a hidden product, an own line without a price, clearing an own line's price
    for bad in ({"sku": 4}, {"sku": 999}, {"name": "Доставка"}, {"price": "10"}):
        assert (await seller.post(f"/api/quotes/{q['id']}/items", json={"items": [bad]})).status_code == 422, bad
    assert (await seller.patch(f"/api/quotes/{q['id']}/items/{own['id']}", json={"price": None})).status_code == 422

    # the same product again adds to its quantity; a price typed in for a product without one
    q = await add(seller, q["id"], {"sku": 3, "qty": 4})
    assert line(q, 3)["qty"] == 5 and len(q["items"]) == 3
    q = await patch_line(seller, q["id"], line(q, 5)["id"], price="10")
    assert q["totals"]["unpriced"] == 0


async def test_costs_stay_until_refreshed(seller):
    q = await new_quote(seller)
    q = await add(seller, q["id"], {"sku": 2, "qty": 1})
    async with SessionLocal() as s:
        await s.execute(update(Product).where(Product.sku == 2).values(price_wholesale_cashless=Decimal(350), rrp=Decimal(500)))
        await s.commit()
    try:
        q = (await seller.get(f"/api/quotes/{q['id']}")).json()
        kb = line(q, 2)
        assert (kb["cost"], kb["current_cost"], kb["sale_price"], q["totals"]["changed"]) == (340, 350, 408, 1)
        r = await seller.post(f"/api/quotes/{q['id']}/refresh")
        kb = line(r.json(), 2)
        assert (kb["cost"], kb["rrp"], kb["sale_price"], r.json()["totals"]["changed"]) == (350, 500, 420, 0)
        # another payment method takes its prices
        q = await patch(seller, q["id"], payment="cash")
        assert line(q, 2)["cost"] == 333
    finally:
        async with SessionLocal() as s:
            await s.execute(update(Product).where(Product.sku == 2).values(price_wholesale_cashless=Decimal(340), rrp=None))
            await s.commit()


async def test_edit_fields(seller):
    q = await new_quote(seller)
    q = await patch(seller, q["id"], customer="  ИП Петров ", customer_contact="Пётр, +7 978 000-00-00", terms="Оплата 100 %", valid_until="2026-12-31", show_photos=False)
    assert (q["customer"], q["terms"], q["valid_until"], q["show_photos"]) == ("ИП Петров", "Оплата 100 %", "2026-12-31", False)
    q = await patch(seller, q["id"], customer="", valid_until=None)
    assert q["customer"] is None and q["valid_until"] is None
    for bad in ({"vat_rate": 18}, {"round_to": 5}, {"markup_percent": -1}, {"payment": None}, {"use_rrp": None}):
        assert (await seller.patch(f"/api/quotes/{q['id']}", json=bad)).status_code == 422, bad


async def test_lines_order_and_removal(seller):
    q = await new_quote(seller)
    q = await add(seller, q["id"], {"sku": 1}, {"sku": 2}, {"name": "Монтаж", "price": "100"})
    assert [i["sku"] for i in q["items"]] == [1, 2, None]
    q = await patch_line(seller, q["id"], line(q, name="Монтаж")["id"], position=0)
    assert [i["sku"] for i in q["items"]] == [None, 1, 2]
    q = await patch_line(seller, q["id"], line(q, 1)["id"], position=99, qty=3, name="Мышь беспроводная")
    assert [i["sku"] for i in q["items"]] == [None, 2, 1] and line(q, 1)["qty"] == 3 and line(q, 1)["name"] == "Мышь беспроводная"
    r = await seller.delete(f"/api/quotes/{q['id']}/items/{line(q, 2)['id']}")
    assert [i["sku"] for i in r.json()["items"]] == [None, 1]
    # added after the removal: at the end
    q = await add(seller, q["id"], {"sku": 2})
    assert [i["sku"] for i in q["items"]] == [None, 1, 2]


async def test_copy_and_delete(seller):
    q = await new_quote(seller, title="Склад")
    q = await add(seller, q["id"], {"sku": 1, "qty": 2}, {"name": "Монтаж", "price": "100"})
    await patch_line(seller, q["id"], line(q, 1)["id"], markup_percent=40)
    r = await seller.post(f"/api/quotes/{q['id']}/copy")
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["id"] != q["id"] and c["number"] == q["number"] + 1 and c["title"] == "Склад"
    assert [(i["sku"], i["qty"], i["markup_percent"]) for i in c["items"]] == [(1, 2, 40), (None, 1, None)]
    assert (await seller.delete(f"/api/quotes/{q['id']}")).status_code == 204
    assert (await seller.get(f"/api/quotes/{q['id']}")).status_code == 404
    listed = (await seller.get("/api/quotes")).json()
    assert [i["id"] for i in listed["items"]] == [c["id"]]
    assert listed["items"][0]["total"] == 146 * 2 + 100 and listed["items"][0]["lines"] == 2


async def test_who_sees_an_offer(client, seller):
    """The author and the organization's head; not another client, nor a person who has left the organization."""
    head_q = await new_quote(seller)
    org_id = head_q["organization_id"]
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as buyer, httpx.AsyncClient(
        transport=client._transport, base_url="http://test"
    ) as other:
        await register(buyer, "q-buyer@example.com")
        await register(other, "q-other@example.com")
        await approve("q-other@example.com")
        async with SessionLocal() as s:
            uid = await s.scalar(select(User.id).where(User.email == "q-buyer@example.com"))
            s.add(OrganizationMember(organization_id=org_id, user_id=uid, role="buyer"))
            await s.commit()
        assert (await buyer.put("/api/cart/organization", json={"organization_id": org_id})).status_code == 200

        buyer_q = await new_quote(buyer)
        assert buyer_q["organization_id"] == org_id and buyer_q["number"] == head_q["number"] + 1
        assert {i["id"] for i in (await seller.get("/api/quotes")).json()["items"]} >= {head_q["id"], buyer_q["id"]}
        assert [i["id"] for i in (await buyer.get("/api/quotes")).json()["items"]] == [buyer_q["id"]]
        assert (await buyer.get(f"/api/quotes/{head_q['id']}")).status_code == 404
        assert (await seller.get(f"/api/quotes/{buyer_q['id']}")).status_code == 200
        assert (await other.get(f"/api/quotes/{head_q['id']}")).status_code == 404
        assert (await other.patch(f"/api/quotes/{head_q['id']}", json={"title": "x"})).status_code == 404
        assert (await other.delete(f"/api/quotes/{head_q['id']}")).status_code == 404

        async with SessionLocal() as s:
            await s.execute(OrganizationMember.__table__.delete().where(OrganizationMember.user_id == uid))
            await s.commit()
        assert (await buyer.get(f"/api/quotes/{buyer_q['id']}")).status_code == 404
        assert (await buyer.get("/api/quotes")).json()["total"] == 0


async def test_profile(client, seller):
    q = await new_quote(seller)
    org_id = q["organization_id"]
    r = await seller.get(f"/api/quotes/profile/{org_id}")
    assert r.status_code == 200 and r.json()["can_edit"] is True and r.json()["bik"] is None

    body = {
        "phone": "+7 978 111-22-33", "email": "sales@romashka.ru", "website": "romashka.ru", "bank_name": "РНКБ Банк (ПАО)",
        "bik": "043510607", "account": "4070 2810 0000 0000 0001", "corr_account": "30101810335100000607",
        "signer_title": "Директор", "signer_name": "Иванов И. И.", "markup_percent": "35", "vat_rate": 22, "valid_days": 5, "terms": "Доставка бесплатно",
    }
    r = await seller.put(f"/api/quotes/profile/{org_id}", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["account"] == "40702810000000000001"
    for bad in ({"bik": "12345"}, {"account": "123"}, {"vat_rate": 18}, {"valid_days": 0}):
        assert (await seller.put(f"/api/quotes/profile/{org_id}", json={**body, **bad})).status_code == 422, bad

    q = await new_quote(seller)
    assert (q["markup_percent"], q["vat_rate"], q["terms"]) == (35, 22, "Доставка бесплатно")
    assert q["valid_until"] == (date.today() + timedelta(days=5)).isoformat()
    assert q["seller"]["profile"]["signer_name"] == "Иванов И. И."

    # a purchaser reads it, only the head changes it; another client does not see it
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as buyer:
        await register(buyer, "profile-buyer@example.com")
        async with SessionLocal() as s:
            uid = await s.scalar(select(User.id).where(User.email == "profile-buyer@example.com"))
            s.add(OrganizationMember(organization_id=org_id, user_id=uid, role="buyer"))
            await s.commit()
        r = await buyer.get(f"/api/quotes/profile/{org_id}")
        assert r.status_code == 200 and r.json()["can_edit"] is False and r.json()["phone"] == "+7 978 111-22-33"
        assert (await buyer.put(f"/api/quotes/profile/{org_id}", json=body)).status_code == 403
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as other:
        await register(other, "profile-other@example.com")
        assert (await other.get(f"/api/quotes/profile/{org_id}")).status_code == 404
