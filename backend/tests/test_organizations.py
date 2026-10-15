"""Client organizations: registration with one, requisites checks, one record per company, its people and their
roles, the manager's check and contracts, switching the organization the cart is priced for, and orders keeping
its requisites."""

import itertools
from decimal import Decimal

import httpx
import pytest
from conftest import signup_code, approve, client_of, company_inn, login, register, reset_db

from app.api import account as account_api
from app.api import orders as orders_api
from app.api.auth import _failures
from app.auth import ensure_admin
from app.db import SessionLocal
from app.models import Category, Product
from app.models.organizations import valid_inn, valid_ogrn

COMPANY = {"name": "ООО «Ромашка»", "inn": "7707083893", "kpp": "773601001", "ogrn": "1027700132195", "address": "Симферополь, ул. Ленина, 1"}
SOLE_TRADER = {"name": "ИП Иванов И. И.", "inn": "500100732259", "ogrn": "304500116000157"}
CONTACTS = {"customer_name": "Иван", "phone": "+7 978 111-22-33", "delivery": "pickup", "payment_method": "cashless"}
CONTRACT = {"number": "15/2026", "signed_on": "2026-09-01", "terms": "deferred", "deferral_days": 14}
_inns = itertools.count(5000)


def fresh(**fields) -> dict:
    """Requisites of a company nobody has registered yet."""
    return {"name": "ООО «Новая»", "inn": company_inn(next(_inns)), **fields}


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        await ensure_admin(s)
        s.add(Category(id=1, name="Периферия", slug="periferiya", path="/1/"))
        await s.flush()
        s.add(Product(
            sku=1, name="Мышь", slug="p1", category_id=1, search_text="мышь", in_stock=True, supplier_price=Decimal(60),
            price=Decimal(100), price_retail_cashless=Decimal(105), price_wholesale_cash=Decimal(80), price_wholesale_cashless=Decimal(84),
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
async def browser(client):
    """make(): a browser (cookies) of its own."""
    opened = []

    def make() -> httpx.AsyncClient:
        opened.append(httpx.AsyncClient(transport=client._transport, base_url="http://test"))
        return opened[-1]

    yield make
    for c in opened:
        await c.aclose()


async def review(client, admin, org_id: int, status: str, note: str | None = None) -> dict:
    r = await client.post(f"/api/admin/organizations/{org_id}/review", json={"status": status, "note": note}, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


async def orgs_of(c: httpx.AsyncClient) -> list[dict]:
    return (await c.get("/api/account/organizations")).json()


def test_requisites_check_digits():
    assert valid_inn("7707083893") and valid_inn("500100732259")
    assert not valid_inn("7707083894") and not valid_inn("500100732258") and not valid_inn("770708389") and not valid_inn("77070838９3")
    assert valid_ogrn("1027700132195") and valid_ogrn("304500116000157")
    assert not valid_ogrn("1027700132196") and not valid_ogrn("304500116000158") and not valid_ogrn("12345")


async def test_registration_with_an_organization(client, admin, browser):
    ivan = browser()
    user = (await register(ivan, "ivan@example.com", organization={**COMPANY, "inn": " 7707 083 893 ", "address": "  "}, name="Иван"))["user"]
    assert user["email"] == "ivan@example.com"
    (org,) = await orgs_of(ivan)
    assert (org["name"], org["inn"], org["kpp"], org["address"], org["status"], org["role"], org["contracts"]) == (
        "ООО «Ромашка»", "7707083893", "773601001", None, "pending", "owner", [],
    )

    # the organization is required and checked; nothing is created when it is refused
    other = browser()
    base = {"email": "petr@example.com", "password": "secret-123", "code": await signup_code(other, "petr@example.com")}
    cases = [
        ({}, None),
        ({"organization": {**fresh(), "inn": "7707083894"}}, "Контрольная цифра ИНН"),
        ({"organization": {**fresh(), "inn": "12345"}}, "10 цифр у организации"),
        ({"organization": fresh(kpp="12345")}, "Проверьте КПП"),
        ({"organization": fresh(ogrn="1027700132196")}, "Проверьте ОГРН"),
        ({"organization": fresh(ogrn="304500116000157")}, "Проверьте ОГРН"),  # a sole trader's number for a company
        ({"organization": {**SOLE_TRADER, "ogrn": "1027700132195"}}, "Проверьте ОГРНИП"),
        ({"organization": fresh(name=" ")}, None),
        ({"organization": fresh(address="x" * 513)}, None),
    ]
    for fields, message in cases:
        r = await other.post("/api/auth/register", json={**base, **fields})
        assert r.status_code == 422 and (message is None or message in r.text), fields
    # Someone else's request for the same company is accepted while ivan's is not checked: whoever registers
    # a company's ИНН first does not lock the company out. Only one of them can be approved.
    squatter = browser()
    await register(squatter, "squatter@example.com", organization=COMPANY)
    (fake,) = await orgs_of(squatter)
    detail = (await client.get(f"/api/admin/organizations/{org['id']}", headers=admin)).json()
    assert [(o["id"], o["status"], o["owner"]["email"]) for o in detail["same_company"]] == [(fake["id"], "pending", "squatter@example.com")]
    await review(client, admin, org["id"], "approved")
    r = await client.post(f"/api/admin/organizations/{fake['id']}/review", json={"status": "approved"}, headers=admin)
    assert r.status_code == 409 and f"№ {org['id']}" in r.json()["detail"]
    await review(client, admin, fake["id"], "rejected", "Не ваша организация")
    # the company is a client now: the same ИНН and КПП, or a missing КПП, is refused
    for org in (COMPANY, {**COMPANY, "kpp": None}, {"name": "Другое имя", "inn": "7707083893"}):
        r = await other.post("/api/auth/register", json={**base, "organization": org})
        assert r.status_code == 409 and r.json()["detail"] == account_api.ALREADY_REGISTERED
    assert (await other.post("/api/auth/login", json=base)).status_code == 401  # no user was created
    # a branch (the same ИНН, another КПП) is another client; a sole trader has no КПП
    await register(other, "petr@example.com", organization={**COMPANY, "kpp": "773602002"}, code=base["code"])
    trader = (await register(browser(), "trader@example.com", organization={**SOLE_TRADER, "kpp": "773601001"}))["user"]
    assert trader["email"] == "trader@example.com"
    r = await other.post("/api/auth/register", json={"email": "ivan@example.com", "code": "000000", "password": "secret-123", "organization": fresh()})
    assert r.status_code == 409  # the e-mail


async def test_client_manages_organizations(client, admin, browser):
    anna = browser()
    await register(anna, "anna@example.com", organization=fresh(name="ООО «Анна»"))
    (first,) = await orgs_of(anna)
    r = await anna.post("/api/account/organizations", json={"name": "Снова Анна", "inn": first["inn"], "kpp": first["kpp"]})
    assert r.status_code == 409 and "уже есть в вашем кабинете" in r.json()["detail"]
    second = (await anna.post("/api/account/organizations", json=fresh(name="ООО «Второе»", kpp=None))).json()
    assert (second["status"], second["role"], second["kpp"]) == ("pending", "owner", None)
    assert [o["name"] for o in await orgs_of(anna)] == ["ООО «Анна»", "ООО «Второе»"]

    # approved, then edited by its head: back to the check; unchanged requisites change nothing
    await review(client, admin, first["id"], "approved")
    url = f"/api/account/organizations/{first['id']}"
    same = {k: first[k] for k in ("name", "inn", "kpp", "ogrn", "address")}
    assert (await anna.put(url, json={**same, "inn": " " + same["inn"]})).json()["status"] == "approved"
    r = await anna.put(url, json={**same, "address": "Севастополь, ул. Ленина, 2"})
    assert (r.json()["status"], r.json()["address"]) == ("pending", "Севастополь, ул. Ленина, 2")
    assert (await review(client, admin, first["id"], "rejected", "  Не совпадает адрес  "))["review_note"] == "Не совпадает адрес"
    assert (await orgs_of(anna))[0]["review_note"] == "Не совпадает адрес"
    r = await anna.put(url, json={**same, "address": "Симферополь"})
    assert (r.json()["status"], r.json()["review_note"]) == ("pending", None)
    r = await anna.put(f"/api/account/organizations/{second['id']}", json=COMPANY)
    assert r.status_code == 409  # would become another client's company

    # a purchaser added by the manager sees it, but only its head changes it
    boris = browser()
    await register(boris, "boris@example.com")
    r = await client.post(f"/api/admin/organizations/{first['id']}/members", json={"email": "boris@example.com"}, headers=admin)
    assert [(m["email"], m["role"]) for m in r.json()["members"]] == [("anna@example.com", "owner"), ("boris@example.com", "buyer")]
    assert [(o["name"], o["role"]) for o in await orgs_of(boris)][1] == ("ООО «Анна»", "buyer")
    for r in (await boris.put(url, json=same), await boris.delete(url)):
        assert r.status_code == 403 and r.json()["detail"] == account_api.OWNER_ONLY
    # outsiders and guests see and change none of it
    olga = browser()
    await register(olga, "olga@example.com")
    assert [o["name"] for o in await orgs_of(olga)] == ["ООО «olga»"]
    assert (await olga.put(url, json=same)).status_code == 404 and (await olga.delete(url)).status_code == 404
    assert (await browser().get("/api/account/organizations")).status_code == 401

    # deleted by its head, unless a manager entered its contracts
    await client.post(f"/api/admin/organizations/{first['id']}/contracts", json=CONTRACT, headers=admin)
    r = await anna.delete(url)
    assert r.status_code == 409 and "менеджер" in r.json()["detail"]
    assert (await anna.delete(f"/api/account/organizations/{second['id']}")).status_code == 204
    assert [o["name"] for o in await orgs_of(anna)] == ["ООО «Анна»"]


async def test_organizations_limit(browser, monkeypatch):
    monkeypatch.setattr(account_api, "MAX_ORGANIZATIONS", 1)
    c = browser()
    await register(c, "limit@example.com")
    r = await c.post("/api/account/organizations", json=fresh())
    assert r.status_code == 409 and r.json()["detail"] == "Можно добавить не больше 1 организаций"


async def test_manager_checks_organizations_people_and_contracts(client, admin, browser):
    petr = browser()
    await register(petr, "petr2@example.com", organization=fresh(name="ИП Петров"), name="Пётр", phone="+79780000000")
    (org,) = await orgs_of(petr)
    assert (await client.get("/api/admin/dashboard", headers=admin)).json()["organizations"]["pending"] >= 1

    page = (await client.get("/api/admin/organizations", params={"q": "petr2@"}, headers=admin)).json()
    (item,) = page["items"]
    assert (item["id"], item["status"], item["owner"]["email"], item["owner"]["name"], item["members"], item["contracts"]) == (
        org["id"], "pending", "petr2@example.com", "Пётр", 1, 0,
    )
    assert page["counts"]["pending"] >= 1
    assert [o["id"] for o in (await client.get("/api/admin/organizations", params={"q": org["inn"][2:9]}, headers=admin)).json()["items"]] == [org["id"]]
    assert all(o["status"] == "pending" for o in (await client.get("/api/admin/organizations", params={"status": "pending"}, headers=admin)).json()["items"])

    r = await client.post(f"/api/admin/organizations/{org['id']}/review", json={"status": "rejected", "note": " "}, headers=admin)
    assert r.status_code == 422 and "Укажите причину" in r.text
    d = await review(client, admin, org["id"], "approved", "ignored")
    assert (d["status"], d["review_note"], d["reviewed_by"]) == ("approved", None, "Администратор") and d["reviewed_at"]
    assert [(m["email"], m["role"], m["phone"]) for m in d["members"]] == [("petr2@example.com", "owner", "+79780000000")]
    d = await review(client, admin, org["id"], "pending")
    assert (d["status"], d["reviewed_at"], d["reviewed_by"]) == ("pending", None, None)

    # people: a registered user is added, gets another role, is removed; the organization keeps a head
    members = f"/api/admin/organizations/{org['id']}/members"
    r = await client.post(members, json={"email": "nobody@example.com"}, headers=admin)
    assert r.status_code == 404 and r.json()["detail"] == "Пользователь с таким e-mail не зарегистрирован"
    sasha = browser()
    sasha_id = (await register(sasha, "sasha@example.com"))["user"]["id"]
    assert (await client.post(members, json={"email": " Sasha@Example.com ", "role": "buyer"}, headers=admin)).status_code == 201
    assert (await client.post(members, json={"email": "sasha@example.com"}, headers=admin)).status_code == 409
    petr_id = (await petr.get("/api/auth/me")).json()["id"]
    r = await client.put(f"{members}/{petr_id}", json={"role": "buyer"}, headers=admin)
    assert r.status_code == 409 and r.json()["detail"] == "У организации должен остаться руководитель"
    assert (await client.delete(f"{members}/{petr_id}", headers=admin)).status_code == 409
    r = await client.put(f"{members}/{sasha_id}", json={"role": "owner"}, headers=admin)
    assert [(m["email"], m["role"]) for m in r.json()["members"]] == [("petr2@example.com", "owner"), ("sasha@example.com", "owner")]
    r = await client.delete(f"{members}/{petr_id}", headers=admin)  # another head is left
    assert [m["email"] for m in r.json()["members"]] == ["sasha@example.com"]
    assert [o["id"] for o in await orgs_of(petr)] == []
    assert (await client.delete(f"{members}/{petr_id}", headers=admin)).status_code == 404

    url = f"/api/admin/organizations/{org['id']}/contracts"
    r = await client.post(url, json={**CONTRACT, "deferral_days": None}, headers=admin)
    assert r.status_code == 422 and "срок отсрочки" in r.text
    assert (await client.post(url, json={**CONTRACT, "number": " 15/2026 "}, headers=admin)).status_code == 201
    r = await client.post(url, json={"number": "1-П", "signed_on": "2026-10-01", "deferral_days": 30}, headers=admin)
    contracts = r.json()["contracts"]
    assert [(c["number"], c["terms"], c["deferral_days"], c["is_active"]) for c in contracts] == [
        ("1-П", "prepayment", None, True),  # newest first; no deferral with prepayment
        ("15/2026", "deferred", 14, True),
    ]
    first = contracts[1]["id"]
    r = await client.put(f"/api/admin/contracts/{first}", json={**CONTRACT, "is_active": False}, headers=admin)
    assert [c["is_active"] for c in r.json()["contracts"]] == [True, False]
    found = (await client.get("/api/admin/organizations", params={"q": "sasha@"}, headers=admin)).json()["items"]
    assert {o["id"]: o["contracts"] for o in found}[org["id"]] == 1  # Sasha's own organization is found too
    r = await client.delete(f"/api/admin/contracts/{first}", headers=admin)
    assert [c["number"] for c in r.json()["contracts"]] == ["1-П"]
    assert (await client.delete(f"/api/admin/contracts/{first}", headers=admin)).status_code == 404

    r = await client.put(f"/api/admin/organizations/{org['id']}", json={"name": "ИП Петров П. П.", "inn": org["inn"]}, headers=admin)
    assert (r.json()["name"], r.json()["status"]) == ("ИП Петров П. П.", "pending")  # a manager's correction keeps the status
    assert [c["number"] for c in (await orgs_of(sasha))[1]["contracts"]] == ["1-П"]
    assert (await client.delete(f"/api/admin/organizations/{org['id']}", headers=admin)).status_code == 204
    assert (await client.get(f"/api/admin/organizations/{org['id']}", headers=admin)).status_code == 404
    assert (await client.get("/api/admin/organizations")).status_code == 401


async def test_switching_the_organization_of_the_cart(client, admin, browser):
    olga = await client_of(client, "olga2@example.com")
    first_id = (await olga.get("/api/cart")).json()["organization"]["id"]
    second = (await olga.post("/api/account/organizations", json=fresh(name="ООО «Вторая»"))).json()
    await olga.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 2}]})

    # not checked yet: it cannot be chosen
    r = await olga.put("/api/cart/organization", json={"organization_id": second["id"]})
    assert r.status_code == 409 and "ещё не подтверждена" in r.json()["detail"]
    await review(client, admin, second["id"], "approved")
    cart = (await olga.put("/api/cart/organization?payment=cashless", json={"organization_id": second["id"]})).json()
    assert (cart["organization"]["id"], cart["price_type"], cart["totals"]) == (second["id"], "wholesale_cashless", {"cash": 160.0, "cashless": 168.0})
    assert (await olga.get("/api/cart")).json()["organization"]["id"] == second["id"]  # kept, the lines too
    # someone else's organization, an unknown one, a bad body
    stranger = await client_of(client, "stranger@example.com")
    stranger_org = (await stranger.get("/api/cart")).json()["organization"]["id"]
    for org_id in (stranger_org, 10**6):
        r = await olga.put("/api/cart/organization", json={"organization_id": org_id})
        assert r.status_code == 404 and r.json()["detail"] == "Организация не найдена"
    assert (await olga.put("/api/cart/organization", json={"organization_id": None})).status_code == 422

    # the chosen one is rejected: the cart falls back to another approved one; none left: no prices
    await review(client, admin, second["id"], "rejected", "Нет договора")
    assert (await olga.get("/api/cart")).json()["organization"]["id"] == first_id
    await review(client, admin, first_id, "pending")
    r = await olga.get("/api/cart")
    assert r.status_code == 403
    await review(client, admin, second["id"], "approved")
    assert (await olga.get("/api/cart")).json()["lines"] == 1
    await stranger.aclose()
    await olga.aclose()


async def test_order_keeps_the_requisites_of_its_organization(client, admin):
    ivan = await client_of(client, "ivan2@example.com")
    org = (await ivan.get("/api/cart")).json()["organization"]
    contracts = (await client.post(f"/api/admin/organizations/{org['id']}/contracts", json=CONTRACT, headers=admin)).json()["contracts"]
    contract_id = contracts[0]["id"]
    other = await client_of(client, "other@example.com")
    other_org = (await other.get("/api/cart")).json()["organization"]["id"]
    other_contract = (await client.post(f"/api/admin/organizations/{other_org}/contracts", json=CONTRACT, headers=admin)).json()["contracts"][0]["id"]

    await ivan.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 3}]})
    r = await ivan.post("/api/orders", json={**CONTACTS, "contract_id": other_contract})
    assert r.status_code == 409 and r.json()["detail"].startswith("Договор недоступен")
    r = await ivan.post("/api/orders", json={**CONTACTS, "contract_id": contract_id, "expected_total": 252})
    assert r.status_code == 201, r.text
    o = r.json()
    assert (o["total"], o["items"][0]["price"]) == (252.0, 84.0)  # wholesale cashless
    assert o["buyer"] == {
        "name": org["name"], "inn": org["inn"], "kpp": None, "ogrn": None, "address": None,
        "contract": {"id": contract_id, "number": "15/2026", "signed_on": "2026-09-01", "terms": "deferred", "deferral_days": 14},
    }

    # a closed contract is no longer offered; without a contract the manager settles it
    await client.put(f"/api/admin/contracts/{contract_id}", json={**CONTRACT, "is_active": False}, headers=admin)
    await ivan.post("/api/cart/items", json={"items": [{"sku": 1, "qty": 1}]})
    assert (await ivan.post("/api/orders", json={**CONTACTS, "contract_id": contract_id})).status_code == 409
    r = await ivan.post("/api/orders", json={**CONTACTS, "payment_method": "cash"})
    assert r.status_code == 201 and r.json()["buyer"]["contract"] is None and r.json()["total"] == 80.0
    second = r.json()

    # the manager sees the buyer, finds the orders by the ИНН; the orders outlive changes of the organization
    d = (await client.get(f"/api/admin/orders/{o['id']}", headers=admin)).json()
    assert (d["price_type"], d["organization_id"], d["buyer_name"], d["buyer"]["contract"]["number"]) == (
        "wholesale_cashless", org["id"], org["name"], "15/2026",
    )
    found = (await client.get("/api/admin/orders", params={"q": org["inn"]}, headers=admin)).json()["items"]
    assert {i["id"] for i in found} == {o["id"], second["id"]}
    assert [x["id"] for x in (await client.get(f"/api/admin/organizations/{org['id']}", headers=admin)).json()["orders"]] == [second["id"], o["id"]]
    await client.put(f"/api/admin/organizations/{org['id']}", json={"name": "ООО «Переименована»", "inn": org["inn"]}, headers=admin)
    await client.delete(f"/api/admin/organizations/{org['id']}", headers=admin)
    d = (await ivan.get(f"/api/orders/{o['id']}")).json()
    assert (d["buyer"]["name"], d["buyer"]["contract"]["number"]) == (org["name"], "15/2026")
    assert [i["buyer_name"] for i in (await ivan.get("/api/orders")).json()["items"]] == [org["name"]] * 2
    assert (await ivan.get("/api/cart")).status_code == 403  # no organization left
    for c in (ivan, other):
        await c.aclose()
    assert await approve("other@example.com") == other_org
