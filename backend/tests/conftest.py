import itertools
import os
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


async def register(client: httpx.AsyncClient, email: str, password: str = "secret-123", organization: dict | None = None, **fields) -> dict:
    """Registers a client with an organization of their own (a fresh ИНН unless given); the response's JSON."""
    org = organization or {"name": f"ООО «{email.split('@')[0]}»", "inn": company_inn(next(_inn_seq))}
    r = await client.post("/api/auth/register", json={"email": email, "password": password, "organization": org, **fields})
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
