"""Runtime settings edited from the admin panel, stored as JSON in `site_settings`."""

import time

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import SiteSetting
from app.supplier.client import IMAGE_RPS_LIMIT

# The worker's share of the supplier's photo downloads; the rest (at least SITE_RPS_MIN) is for photos
# opened on the site or in the lab before the worker processed them.
SITE_RPS_MIN = 0.5


class ShopSettings(BaseModel):
    name: str = "IT Trade"
    tagline: str = "Компьютерная техника и электроника в Крыму"
    phone: str = ""
    email: str = ""
    address: str = ""
    working_hours: str = ""
    show_out_of_stock: bool = False
    # product page gallery, see app/images/gallery.py
    gallery_min_side: int = Field(400, ge=0, description="Secondary photos smaller than this on the longer side are hidden, px")
    gallery_dedupe: bool = Field(True, description="Show one of near-identical photos (re-uploads, a slide in several languages)")


class ImageSettings(BaseModel):
    """Loading of product photos by the worker (admin page "Загрузка каталога")."""

    # A fresh production install starts paused: the photos take days to load, so the setup is checked
    # first (readiness checks, a trial batch). Photos opened on the site are processed even when paused.
    paused: bool = Field(default_factory=lambda: get_settings().is_prod, description="The worker loads no photos")
    per_product: int = Field(8, ge=1, le=50, description="Only the first N photos of a product (the main one first) are loaded and shown")
    gallery: bool = Field(True, description="Load the other photos in advance, after all main ones; otherwise on the first view of the product")
    reprocess: bool = Field(True, description="Process photos of an older processing version again, after the new ones")
    download_rps: float = Field(3.0, ge=0.5, le=IMAGE_RPS_LIMIT - SITE_RPS_MIN, description="Photo downloads per second by the worker")

    def site_rps(self, processes: int) -> float:
        """Downloads per second left to each API process."""
        return max(0.1, (IMAGE_RPS_LIMIT - self.download_rps) / max(1, processes))


# Markup rules are kept per supplier, see app/pricing.py
SETTINGS: dict[str, type[BaseModel]] = {"shop": ShopSettings, "images": ImageSettings}


async def get_settings_obj[T: BaseModel](session: AsyncSession, model: type[T]) -> T:
    key = next(k for k, v in SETTINGS.items() if v is model)
    row = await session.get(SiteSetting, key)
    return model.model_validate(row.value) if row else model()


async def save_settings_obj(session: AsyncSession, obj: BaseModel) -> None:
    key = next(k for k, v in SETTINGS.items() if v is type(obj))
    value = obj.model_dump(mode="json")
    row = await session.get(SiteSetting, key)
    if row:
        row.value = value
    else:
        session.add(SiteSetting(key=key, value=value))
    _cache.pop(type(obj), None)


_cache: dict[type, tuple[float, BaseModel]] = {}
CACHE_TTL = 30.0


async def cached_settings_obj[T: BaseModel](session: AsyncSession, model: type[T]) -> T:
    """get_settings_obj, re-read at most every CACHE_TTL seconds: for hot paths of the API (each API
    process has its own copy, so a change made in another process shows up within CACHE_TTL)."""
    hit = _cache.get(model)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]  # type: ignore[return-value]
    obj = await get_settings_obj(session, model)
    _cache[model] = (time.monotonic(), obj)
    return obj
