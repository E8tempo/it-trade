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
