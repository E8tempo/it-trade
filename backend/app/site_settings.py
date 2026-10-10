"""Runtime settings edited from the admin panel, stored as JSON in `site_settings`."""

from decimal import ROUND_CEILING, Decimal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SiteSetting


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


SETTINGS: dict[str, type[BaseModel]] = {"pricing": PricingSettings, "shop": ShopSettings}


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


def retail_price(supplier_price: Decimal, rrp: Decimal | None, category_path: str | None, s: PricingSettings) -> Decimal:
    """`category_path` is the materialized path "/root/.../leaf/" - the nearest override wins."""
    pct = s.markup_percent
    if category_path and s.category_markups:
        for cid in reversed(category_path.strip("/").split("/")):
            if cid and int(cid) in s.category_markups:
                pct = s.category_markups[int(cid)]
                break
    price = supplier_price * (1 + pct / 100)
    price = max(price, supplier_price + s.min_markup)
    if s.use_rrp and rrp and rrp >= supplier_price + s.min_markup:
        price = rrp
    step = Decimal(s.round_to)
    return ((price / step).to_integral_value(rounding=ROUND_CEILING) * step).quantize(Decimal("0.01"))

