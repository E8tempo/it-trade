import itertools
import os
import re
import tempfile
from pathlib import Path

import httpx
import pytest

# Must be set before `app` is imported: settings and the engine are created at import time.
# Environment variables take precedence over backend/.env and the root .env.
_tmp = Path(tempfile.mkdtemp(prefix="it-trade-test-"))
os.environ.update({
    "APP_ENV": "test",
    "DATABASE_URL": f"sqlite+aiosqlite:///{(_tmp / 'test.db').as_posix()}",
    "MEDIA_ROOT": str(_tmp / "media"),
    "ADMIN_EMAIL": "admin@example.com",
    "ADMIN_PASSWORD": "admin-pass-123",
    "SUPPLIER_LOGIN": "",
    "SUPPLIER_PASSWORD": "",
    "DADATA_API_KEY": "",
    "CATALOG_SAMPLE_PER_CATEGORY": "0",
})


@pytest.fixture
async def client():
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def reset_db():
    from app.db import engine
    from app.models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def login(client: httpx.AsyncClient, email: str, password: str) -> str:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


_inn_seq = itertools.count(1)


def company_inn(n: int) -> str:
    """A valid 10-digit ИНН of a company, a different one for every n."""
    base = f"77{n:07d}"
    check = sum(w * int(d) for w, d in zip((2, 4, 10, 3, 5, 9, 4, 6, 8), base, strict=True)) % 11 % 10
    return f"{base}{check}"


# letters "sent" in the tests: (to, subject, text)
OUTBOX: list[tuple[str, str, str]] = []


@pytest.fixture(autouse=True)
def mail_and_throttle(monkeypatch):
    """Letters go to OUTBOX instead of SMTP; the per-address attempt limits start afresh in every test."""
    import app.api.auth as auth_api

    async def send(to, subject, text, html=None):
        OUTBOX.append((to, subject, text))

    monkeypatch.setattr(auth_api, "send_mail", send)
    auth_api._failures.clear()
    yield
    OUTBOX.clear()


async def signup_code(client: httpx.AsyncClient, email: str) -> str:
    """Asks for the code that registers `email` and reads it from the letter."""
    r = await client.post("/api/auth/register/code", json={"email": email})
    assert r.status_code == 200, r.text
    return re.search(r"\b(\d{6})\b", next(t for to, _, t in reversed(OUTBOX) if to == email.strip().lower())).group(1)


async def register(client: httpx.AsyncClient, email: str, password: str = "secret-123", organization: dict | None = None, **fields) -> dict:
    """Registers a client with an organization of their own (a fresh ИНН unless given); the response's JSON."""
    org = organization or {"name": f"ООО «{email.split('@')[0]}»", "inn": company_inn(next(_inn_seq))}
    code = fields.pop("code", None) or await signup_code(client, email)
    r = await client.post("/api/auth/register", json={"email": email, "code": code, "password": password, "organization": org, **fields})
    assert r.status_code == 201, r.text
    return r.json()


async def approve(email: str) -> int:
    """Approves the organizations of the user (as a manager would); the id of the first one."""
    from sqlalchemy import select, update

    from app.db import SessionLocal
    from app.models import Organization, OrganizationMember, User

    async with SessionLocal() as s:
        ids = (
            await s.scalars(
                select(OrganizationMember.organization_id)
                .join(User, User.id == OrganizationMember.user_id)
                .where(User.email == email)
                .order_by(OrganizationMember.organization_id)
            )
        ).all()
        await s.execute(update(Organization).where(Organization.id.in_(ids)).values(status="approved"))
        await s.commit()
    return ids[0]


async def client_of(client: httpx.AsyncClient, email: str) -> httpx.AsyncClient:
    """A browser of its own (cookies) for a registered client whose organization is approved."""
    c = httpx.AsyncClient(transport=client._transport, base_url="http://test")
    await register(c, email)
    await approve(email)
    return c
