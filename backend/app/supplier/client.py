"""Client for the b2b.i-t-p.pro JSON-RPC API (docs: /download/docs/api/api.html, v2.17)."""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings, get_settings

log = logging.getLogger(__name__)


class SupplierError(RuntimeError):
    pass


class SupplierNotFound(SupplierError):
    """The file does not exist at the supplier (some image records point to missing files)."""


class SupplierUnavailable(SupplierError):
    """Network trouble (timeouts, refused connections): not the request's fault, retry later."""


# Photo downloads the supplier allows per second, in total: the worker takes its share (set in the admin
# panel) and the API processes split the rest for photos opened on the site before the worker got to them.
IMAGE_RPS_LIMIT = 5.0


class RateLimiter:
    """Allows at most one call per `interval` seconds (shared by all coroutines of the process)."""

    def __init__(self, per_second: float):
        self.interval = 1.0 / per_second
        self._lock = asyncio.Lock()
        self._next = 0.0

    def set_rate(self, per_second: float) -> None:
        self.interval = 1.0 / per_second

    async def __aenter__(self):
        async with self._lock:
            now = time.monotonic()
            if self._next > now:
                await asyncio.sleep(self._next - now)
            self._next = max(now, self._next) + self.interval

    async def __aexit__(self, *exc):
        return False


class SupplierClient:
    # Documented limits: login 10/min, images list 2/s, image download 5/s, order items 1/s.
    def __init__(self, settings: Settings | None = None, *, image_rps: float = 1.0):
        self.s = settings or get_settings()
        self._http = httpx.AsyncClient(
            base_url=self.s.supplier_base_url,
            timeout=httpx.Timeout(60, connect=15),
            headers={"User-Agent": "it-trade-sync/1.0"},
            follow_redirects=True,
        )
        self._session: str | None = None
        self._login_lock = asyncio.Lock()
        self._login_limit = RateLimiter(10 / 60)
        self._rpc_limit = RateLimiter(2)
        self._image_limit = RateLimiter(image_rps)

    @property
    def image_rps(self) -> float:
        return 1.0 / self._image_limit.interval

    def set_image_rps(self, rps: float) -> None:
        """Photo downloads per second of this client (the worker's or one API process's share)."""
        self._image_limit.set_rate(rps)

    async def aclose(self):
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.aclose()

    # --- auth -------------------------------------------------------------------------------

    @property
    def has_credentials(self) -> bool:
        return bool(self.s.supplier_login and self.s.supplier_password.get_secret_value())

    async def _login(self) -> str:
        if not self.has_credentials:
            raise SupplierError("SUPPLIER_LOGIN / SUPPLIER_PASSWORD are not configured")
        async with self._login_limit:
            r = await self._http.post(
                "/api/2",
                json={
                    "data": {"login": self.s.supplier_login, "password": self.s.supplier_password.get_secret_value()},
                    "request": {"method": "login", "model": "auth", "module": "quickfox"},
                },
            )
        r.raise_for_status()
        body = r.json()
        if not body.get("success") or not body.get("session"):
            raise SupplierError(f"login failed: {body.get('message')!r}")
        log.info("supplier: logged in")
        return body["session"]

    async def session(self, *, renew: bool = False) -> str:
        async with self._login_lock:
            if renew or not self._session:
                self._session = await self._login()
            return self._session

    # --- JSON-RPC ---------------------------------------------------------------------------

    async def call(
        self,
        module: str,
        model: str,
        method: str,
        *,
        data: Any = None,
        filter: list[dict] | None = None,
        pager: dict | None = None,
        sort: list[dict] | None = None,
        timeout: float | None = None,
    ) -> dict:
        payload: dict[str, Any] = {"request": {"module": module, "model": model, "method": method}}
        for k, v in (("data", data), ("filter", filter), ("pager", pager), ("sort", sort)):
            if v is not None:
                payload[k] = v
        for attempt in range(2):
            payload["session"] = await self.session(renew=attempt > 0)
            async with self._rpc_limit:
                r = await self._http.post("/api/2", json=payload, timeout=timeout or httpx.USE_CLIENT_DEFAULT)
            r.raise_for_status()
            body = r.json()
            if body.get("success"):
                return body
            log.warning("supplier %s.%s failed (attempt %d): %s", model, method, attempt + 1, body.get("message"))
        raise SupplierError(f"{model}.{method}: {body.get('message')!r} (commandid={body.get('commandid')})")

    async def get_active_products(self, *, skus: list[int] | None = None) -> list[dict]:
        """Prices and stock of in-stock products (limit 10/hour for the full list)."""
        flt = [{"property": "sku", "operator": "IN", "value": skus}] if skus else None
        body = await self.call("platform", "client_api", "get_active_products", filter=flt, timeout=600)
        return body["data"]["products"]

    async def get_product_images(self, skus: list[int]) -> list[dict]:
        """Image list for up to 100 products."""
        assert len(skus) <= 100
        body = await self.call(
            "platform",
            "products_clients_images",
            "read_new",
            filter=[{"property": "sku", "operator": "IN", "value": skus}],
        )
        return body["data"]["product_images"]

    async def get_logistic_centers(self) -> list[dict]:
        body = await self.call("platform", "client_api", "get_available_logistic_centers")
        return body["data"]["logistic_centers"]

    # --- static files -----------------------------------------------------------------------

    async def _cookies(self) -> dict[str, str]:
        # Catalog files are currently public, but the docs require the session cookie.
        return {"session": await self.session()} if self.has_credentials else {}

    async def download(self, path: str, dest: Path, progress: Callable[[int, int], Awaitable[None]] | None = None) -> Path:
        """Stream a static file (catalog_tree / products json) to disk; `progress` gets the bytes done and
        the size (0 when the server does not tell it) every few megabytes."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        async with self._http.stream("GET", path, cookies=await self._cookies(), timeout=600) as r:
            if r.status_code != 200:
                raise SupplierError(f"GET {path}: HTTP {r.status_code}")
            size, done, reported = int(r.headers.get("content-length") or 0), 0, 0
            with tmp.open("wb") as f:
                async for chunk in r.aiter_bytes(1 << 20):
                    f.write(chunk)
                    done += len(chunk)
                    if progress and done - reported >= 5 << 20:
                        reported = done
                        await progress(done, size)
        tmp.replace(dest)
        return dest

    async def fetch_image(self, url: str, size: str = "large") -> bytes:
        """Download a product image (IMAGE_RPS_LIMIT, shared between the worker and the API processes)."""
        async with self._image_limit:
            try:
                r = await self._http.get("/" + url.lstrip("/"), params={"size": size}, cookies=await self._cookies())
            except httpx.TransportError as e:
                raise SupplierUnavailable(f"image {url}: {type(e).__name__}") from e
        if r.status_code == 404:
            raise SupplierNotFound(f"image {url}: HTTP 404")
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            raise SupplierError(f"image {url}: HTTP {r.status_code}")
        return r.content
