"""News and promotions: written in the admin panel, shown on the home page once published, promotions until their
last day."""

from datetime import datetime, timedelta

import pytest
from conftest import login, reset_db

from app.api.posts import SHOP_TZ
from app.auth import ensure_admin
from app.db import SessionLocal


@pytest.fixture(scope="module", autouse=True)
async def db():
    await reset_db()
    async with SessionLocal() as s:
        await ensure_admin(s)
    yield


@pytest.fixture
async def admin(client):
    token = await login(client, "admin@example.com", "admin-pass-123")
    client.cookies.clear()
    return {"Authorization": f"Bearer {token}"}


async def test_posts(client, admin):
    today = datetime.now(SHOP_TZ).date()
    r = await client.post("/api/admin/posts", json={"title": " Новый склад ", "body": "Открыли склад в Симферополе.\n\nЖдём вас."}, headers=admin)
    assert r.status_code == 201
    draft = r.json()
    assert (draft["title"], draft["kind"], draft["is_published"], draft["published_at"], draft["pinned"]) == ("Новый склад", "news", False, None, False)
    assert (await client.get("/api/posts")).json() == []  # a draft is not shown

    news = (await client.put(f"/api/admin/posts/{draft['id']}", json={**draft, "is_published": True}, headers=admin)).json()
    assert news["published_at"] is not None
    again = (await client.put(f"/api/admin/posts/{draft['id']}", json={**news, "title": "Новый склад!"}, headers=admin)).json()
    assert again["published_at"] == news["published_at"]  # the first publication orders the home page

    def promo(title: str, ends_on, **fields) -> dict:
        return {"kind": "promo", "title": title, "is_published": True, "ends_on": ends_on and ends_on.isoformat(), **fields}

    ended = (await client.post("/api/admin/posts", json=promo("Прошла", today - timedelta(days=1)), headers=admin)).json()
    last_day = (await client.post("/api/admin/posts", json=promo("Последний день", today, link_url="/catalog"), headers=admin)).json()
    pinned = (await client.post("/api/admin/posts", json=promo("Закреплена", None, pinned=True, link_url="https://example.com/a"), headers=admin)).json()

    shown = (await client.get("/api/posts")).json()
    assert [p["id"] for p in shown] == [pinned["id"], last_day["id"], news["id"]]  # pinned first, then the newest; the ended one is hidden
    assert set(shown[0]) == {"id", "kind", "title", "body", "link_url", "published_at", "pinned", "ends_on"}
    assert [p["id"] for p in (await client.get("/api/posts", params={"kind": "news"})).json()] == [news["id"]]
    assert [p["id"] for p in (await client.get("/api/posts", params={"limit": 1})).json()] == [pinned["id"]]
    assert [p["id"] for p in (await client.get("/api/admin/posts", headers=admin)).json()] == [pinned["id"], last_day["id"], ended["id"], news["id"]]

    for link in ("javascript:alert(1)", "//evil.com", "ftp://x"):
        r = await client.post("/api/admin/posts", json={"title": "x", "link_url": link}, headers=admin)
        assert r.status_code == 422 and "Ссылка" in r.text, link
    assert (await client.post("/api/admin/posts", json={"title": ""}, headers=admin)).status_code == 422
    assert (await client.delete(f"/api/admin/posts/{ended['id']}", headers=admin)).status_code == 204
    assert (await client.delete(f"/api/admin/posts/{ended['id']}", headers=admin)).status_code == 404
    assert (await client.get("/api/admin/posts")).status_code == 401
