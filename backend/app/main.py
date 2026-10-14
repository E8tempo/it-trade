import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import account, admin, auth, cart, catalog, media, orders, posts
from app.auth import ensure_admin
from app.config import get_settings
from app.db import SessionLocal, engine
from app.supplier.client import SupplierClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.media_root.mkdir(parents=True, exist_ok=True)
    async with SessionLocal() as session:
        await ensure_admin(session)
    # photos opened on the site before the worker processed them; the rate is set from the
    # photo loading settings before each download (api/media.py: ondemand_client)
    async with SupplierClient(s) as client:
        app.state.ondemand_client = client
        yield
    await engine.dispose()


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    app = FastAPI(
        title="IT Trade API",
        lifespan=lifespan,
        docs_url="/api/docs" if s.env != "prod" else None,
        openapi_url="/api/openapi.json" if s.env != "prod" else None,
    )
    app.include_router(auth.router)
    app.include_router(catalog.router)
    app.include_router(cart.router)
    app.include_router(orders.router)
    app.include_router(account.router)
    app.include_router(posts.router)
    app.include_router(admin.router)
    app.include_router(media.router)

    @app.get("/api/health", tags=["system"])
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
