"""Runtime settings edited from the admin panel, stored as JSON in `site_settings`."""

import time
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import SiteSetting
from app.supplier.client import IMAGE_RPS_LIMIT

# The worker's share of the supplier's photo downloads; the rest (at least SITE_RPS_MIN) is for photos
# opened on the site or in the lab before the worker processed them.
SITE_RPS_MIN = 0.5


class PricingSettings(BaseModel):
    markup_percent: Decimal = Field(Decimal(20), ge=0, description="Default markup over the supplier price, %")
    # category id -> markup %, inherited by subcategories
    category_markups: dict[int, Decimal] = Field(default_factory=dict)
    min_markup: Decimal = Field(Decimal(0), ge=0, description="Minimal markup in roubles")
    round_to: int = Field(10, ge=1, description="Round prices up to this step, roubles")
    use_rrp: bool = Field(True, description="Use the supplier's recommended retail price when it is set")


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


SETTINGS: dict[str, type[BaseModel]] = {"pricing": PricingSettings, "shop": ShopSettings, "images": ImageSettings}


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


@dataclass(frozen=True)
class PriceBreakdown:
    """Every step of `retail_price`, for the admin panel's calculator."""

    markup_percent: Decimal
    markup_category: int | None  # category whose markup applied, None for the default one
    by_markup: Decimal  # supplier price * (1 + markup / 100)
    floor: Decimal  # supplier price + minimal markup in roubles
    rrp_used: bool
    before_rounding: Decimal
    price: Decimal


def price_breakdown(
    supplier_price: Decimal, rrp: Decimal | None, category_path: str | None, s: PricingSettings
) -> PriceBreakdown:
    """`category_path` is the materialized path "/root/.../leaf/" - the nearest category markup wins."""
    pct, source = s.markup_percent, None
    if category_path and s.category_markups:
        for cid in reversed(category_path.strip("/").split("/")):
            if cid and int(cid) in s.category_markups:
                pct, source = s.category_markups[int(cid)], int(cid)
                break
    by_markup = supplier_price * (1 + pct / 100)
    floor = supplier_price + s.min_markup
    price = max(by_markup, floor)
    rrp_used = bool(s.use_rrp and rrp and rrp >= floor)
    if rrp_used:
        price = rrp
    step = Decimal(s.round_to)
    rounded = ((price / step).to_integral_value(rounding=ROUND_CEILING) * step).quantize(Decimal("0.01"))
    return PriceBreakdown(pct, source, by_markup, floor, rrp_used, price, rounded)


def retail_price(supplier_price: Decimal, rrp: Decimal | None, category_path: str | None, s: PricingSettings) -> Decimal:
    return price_breakdown(supplier_price, rrp, category_path, s).price

