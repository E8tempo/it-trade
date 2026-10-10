from datetime import timedelta

import pytest
from conftest import reset_db

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
    r = await client.post("/api/auth/register", json={"email": " Ivan@Example.com ", "password": "secret-123", "name": "Иван"})
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

    dup = await client.post("/api/auth/register", json={"email": "ivan@example.com", "password": "secret-123"})
    assert dup.status_code == 409
    bad = await client.post("/api/auth/login", json={"email": "ivan@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401
    ok = await client.post("/api/auth/login", json={"email": "IVAN@example.com", "password": "secret-123"})
    assert ok.status_code == 200


async def test_refresh_rotation_and_reuse_detection(client, monkeypatch):
    r = await client.post("/api/auth/register", json={"email": "rot@example.com", "password": "secret-123"})
    first = r.json()["refresh_token"]
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
    await client.post("/api/auth/register", json={"email": "cookie@example.com", "password": "secret-123"})
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
    r = await client.post("/api/auth/register", json={"email": "type@example.com", "password": "secret-123"})
    client.cookies.clear()
    assert (await client.post("/api/auth/refresh", json={"refresh_token": r.json()["access_token"]})).status_code == 401


async def test_change_password_ends_other_sessions(client):
    r = await client.post("/api/auth/register", json={"email": "pw@example.com", "password": "secret-123"})
    old_refresh, access = r.json()["refresh_token"], r.json()["access_token"]
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
