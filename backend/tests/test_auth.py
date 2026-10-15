from datetime import timedelta

import pytest
from conftest import company_inn, register, reset_db, signup_code

import app.auth

from app.api.auth import _failures
from app.auth import decode_token


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    yield


@pytest.fixture(autouse=True)
def no_throttle():
    _failures.clear()


async def test_register_login_me_with_cookies_and_bearer(client):
    org = {"name": "ООО «Иван»", "inn": company_inn(9998)}
    code = await signup_code(client, "ivan@example.com")
    r = await client.post("/api/auth/register", json={"email": " Ivan@Example.com ", "code": code, "password": "secret-123", "name": "Иван", "organization": org})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "ivan@example.com" and body["user"]["role"] == "customer"
    assert decode_token(body["access_token"], "access")["sub"] == str(body["user"]["id"])
    set_cookie = r.headers.get_list("set-cookie")
    assert any(c.startswith("access_token=") and "HttpOnly" in c and "Path=/;" in c for c in set_cookie)
    assert any(c.startswith("refresh_token=") and "HttpOnly" in c and "Path=/;" in c for c in set_cookie)

    # cookie session
    assert (await client.get("/api/auth/me")).json()["name"] == "Иван"
    # bearer, no cookies
    client.cookies.clear()
    assert (await client.get("/api/auth/me")).status_code == 401
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200

    org = {"name": "ООО «Другая»", "inn": company_inn(9999)}
    dup = await client.post("/api/auth/register", json={"email": "ivan@example.com", "code": code, "password": "secret-123", "organization": org})
    assert dup.status_code == 409
    bad = await client.post("/api/auth/login", json={"email": "ivan@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401
    ok = await client.post("/api/auth/login", json={"email": "IVAN@example.com", "password": "secret-123"})
    assert ok.status_code == 200


async def test_refresh_rotation_and_reuse_detection(client, monkeypatch):
    first = (await register(client, "rot@example.com"))["refresh_token"]
    client.cookies.clear()

    r = await client.post("/api/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200
    second = r.json()["refresh_token"]
    assert second != first

    # a concurrent request may present the just-rotated token within the grace period
    assert (await client.post("/api/auth/refresh", json={"refresh_token": first})).status_code == 200
    client.cookies.clear()

    # after the grace period, replaying it revokes the whole family, including the new tokens
    monkeypatch.setattr(app.auth, "REUSE_GRACE", timedelta(0))
    assert (await client.post("/api/auth/refresh", json={"refresh_token": first})).status_code == 401
    monkeypatch.undo()
    assert (await client.post("/api/auth/refresh", json={"refresh_token": second})).status_code == 401


async def test_refresh_via_cookie_and_logout(client):
    await register(client, "cookie@example.com")
    r = await client.post("/api/auth/refresh")  # the refresh_token cookie is sent automatically
    assert r.status_code == 200
    refresh = r.json()["refresh_token"]
    r = await client.post("/api/auth/logout")
    assert r.status_code == 204
    assert all("Max-Age=0" in c for c in r.headers.get_list("set-cookie"))
    client.cookies.clear()
    assert (await client.post("/api/auth/refresh", json={"refresh_token": refresh})).status_code == 401
    assert (await client.post("/api/auth/refresh", json={"refresh_token": "garbage"})).status_code == 401


async def test_access_token_cannot_be_used_as_refresh(client):
    access = (await register(client, "type@example.com"))["access_token"]
    client.cookies.clear()
    assert (await client.post("/api/auth/refresh", json={"refresh_token": access})).status_code == 401


async def test_change_password_ends_other_sessions(client):
    r = await register(client, "pw@example.com")
    old_refresh, access = r["refresh_token"], r["access_token"]
    client.cookies.clear()
    h = {"Authorization": f"Bearer {access}"}
    wrong = await client.post("/api/auth/password", json={"current_password": "nope", "new_password": "secret-456"}, headers=h)
    assert wrong.status_code == 400
    ok = await client.post("/api/auth/password", json={"current_password": "secret-123", "new_password": "secret-456"}, headers=h)
    assert ok.status_code == 200
    client.cookies.clear()
    assert (await client.post("/api/auth/refresh", json={"refresh_token": old_refresh})).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": "pw@example.com", "password": "secret-456"})).status_code == 200


async def test_login_throttling(client):
    for _ in range(10):
        await client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever-1"})
    r = await client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever-1"})
    assert r.status_code == 429


def test_prod_requires_strong_jwt_secret(monkeypatch):
    from pydantic import ValidationError

    from app.config import Settings

    monkeypatch.setenv("APP_ENV", "prod")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
    monkeypatch.setenv("JWT_SECRET", "x" * 40)
    assert Settings(_env_file=None).secure_cookies is True


def test_empty_jwt_secret_in_env_file_counts_as_unset(monkeypatch, tmp_path):
    from pydantic import ValidationError

    from app.config import DEV_JWT_SECRET, Settings

    # the root .env copied from .env.example: `JWT_SECRET=` must not wipe out the dev secret
    env = tmp_path / ".env"
    env.write_text("JWT_SECRET=\n")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("APP_ENV", "dev")
    assert Settings(_env_file=env).jwt_secret.get_secret_value() == DEV_JWT_SECRET
    monkeypatch.setenv("APP_ENV", "prod")
    with pytest.raises(ValidationError):
        Settings(_env_file=env)


async def test_company_lookup_by_inn(client, monkeypatch):
    import app.api.auth as auth_api
    import app.companies as companies

    inn = company_inn(7777)
    # no DaData key: the form asks for the requisites by hand
    r = await client.get("/api/auth/company", params={"inn": inn})
    assert r.status_code == 200 and r.json() == {"configured": False, "available": False, "company": None, "registered": False}
    assert (await client.get("/api/auth/company", params={"inn": "12345"})).status_code == 422

    found = companies.Company(
        inn=inn, kpp="910201001", ogrn="1149102000000", name="ООО «Лес»", full_name=None, address="Симферополь",
        manager="Директор Петров П. П.", sole_trader=False, status="ACTIVE",
    )

    async def fake_find(q):
        return found if q == inn else None

    monkeypatch.setattr(auth_api, "find_company", fake_find)
    r = (await client.get("/api/auth/company", params={"inn": inn})).json()
    assert r["available"] and r["company"]["name"] == "ООО «Лес»" and r["registered"] is False
    assert (await client.get("/api/auth/company", params={"inn": company_inn(7778)})).json()["company"] is None

    # a request that is not checked yet does not count; an approved organization is a client, and the form says
    # so before the rest is filled in
    org = {"name": "ООО «Лес»", "inn": inn, "kpp": "910201001"}
    await register(client, "les@example.com", organization=org)
    client.cookies.clear()
    assert (await client.get("/api/auth/company", params={"inn": inn})).json()["registered"] is False
    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import Organization, OrganizationStatus

    async with SessionLocal() as session:
        await session.execute(update(Organization).where(Organization.inn == inn).values(status=OrganizationStatus.approved))
        await session.commit()
    assert (await client.get("/api/auth/company", params={"inn": inn})).json()["registered"] is True


def test_company_parsing():
    from app.companies import _parse

    c = _parse({
        "value": "ИП Иванов Иван Иванович",
        "data": {"inn": "910200000000", "ogrn": "319910200000000", "type": "INDIVIDUAL", "state": {"status": "ACTIVE"},
                 "name": {"short_with_opf": "ИП Иванов Иван Иванович"}, "address": {"value": "г Симферополь"}},
    })
    assert c.sole_trader and c.kpp is None and c.name == "ИП Иванов Иван Иванович" and c.manager is None


async def test_registration_throttling(client):
    for i in range(10):
        await register(client, f"bot{i}@example.com", organization={"name": "ООО «Бот»", "inn": company_inn(8000 + i)})
        client.cookies.clear()
    assert (await client.post("/api/auth/register/code", json={"email": "bot10@example.com"})).status_code == 429


async def test_signup_needs_the_code_sent_to_the_address(client):
    org = {"name": "ООО «Код»", "inn": company_inn(8100)}
    body = {"email": "code@example.com", "password": "secret-123", "organization": org}
    # no code was sent to the address
    assert (await client.post("/api/auth/register", json={**body, "code": "123456"})).json()["detail"] == "Код устарел. Запросите новый."
    code = await signup_code(client, "code@example.com")
    # another code only after a while; a wrong one counts against the code
    r = await client.post("/api/auth/register/code", json={"email": "code@example.com"})
    assert r.status_code == 429 and "Retry-After" in r.headers
    wrong = "000000" if code != "000000" else "111111"
    r = await client.post("/api/auth/register", json={**body, "code": wrong})
    assert r.status_code == 400 and "Осталось попыток: 4" in r.json()["detail"]
    assert (await client.post("/api/auth/login", json={"email": "code@example.com", "password": "secret-123"})).status_code == 401
    r = await client.post("/api/auth/register", json={**body, "code": code})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    # used up; and an address with an account gets no more codes
    assert (await client.post("/api/auth/register/code", json={"email": "code@example.com"})).status_code == 409


async def test_code_attempts_run_out(client, monkeypatch):
    import app.api.auth as auth_api

    org = {"name": "ООО «Перебор»", "inn": company_inn(8200)}
    code = await signup_code(client, "brute@example.com")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(auth_api.CODE_ATTEMPTS):
        await client.post("/api/auth/register", json={"email": "brute@example.com", "code": wrong, "password": "secret-123", "organization": org})
    # even the right code does not help now: brute force over a million codes is cut at a few tries
    r = await client.post("/api/auth/register", json={"email": "brute@example.com", "code": code, "password": "secret-123", "organization": org})
    assert r.status_code == 400 and "Запросите новый код" in r.json()["detail"]
