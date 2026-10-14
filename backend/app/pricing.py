"""Prices: markup rules per supplier and price type, and the 4 prices of a product computed from them.

Every product has a price of each PriceType (retail / wholesale, cash / cashless), each by its own rules
(PriceRules), stored per supplier in `site_settings` under "pricing:<code>". A price the admin fixed for a
type (Product.price_overrides) wins over that type's rules.
"""

from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Audience, Organization, OrganizationStatus, PriceType, SiteSetting, User
from app.models.catalog import PRICE_COLUMNS


class PriceRules(BaseModel):
    """Markup rules of one price type."""

    markup_percent: Decimal = Field(Decimal(20), ge=0, description="Default markup over the supplier price, %")
    # category id -> markup %, inherited by subcategories
    category_markups: dict[int, Decimal] = Field(default_factory=dict)
    min_markup: Decimal = Field(Decimal(0), ge=0, description="Minimal markup in roubles")
    round_to: int = Field(10, ge=1, description="Round prices up to this step, roubles")
    use_rrp: bool = Field(True, description="Use the supplier's recommended retail price when it is set")


class SupplierPricing(BaseModel):
    """Markup rules of one supplier: one set per price type."""

    retail_cash: PriceRules = Field(default_factory=PriceRules)
    retail_cashless: PriceRules = Field(default_factory=PriceRules)
    wholesale_cash: PriceRules = Field(default_factory=PriceRules)
    wholesale_cashless: PriceRules = Field(default_factory=PriceRules)

    def rules(self, t: PriceType) -> PriceRules:
        return getattr(self, PriceType(t).value)


@dataclass(frozen=True)
class Supplier:
    code: str
    name: str
    url: str


# Static for now: products are not linked to a supplier yet, every one of them comes from IT Partner
SUPPLIERS: dict[str, Supplier] = {"itp": Supplier(code="itp", name="IT Partner", url="https://b2b.i-t-p.pro")}
DEFAULT_SUPPLIER = "itp"


def _key(code: str) -> str:
    return f"pricing:{code}"


async def get_supplier_pricing(session: AsyncSession, code: str) -> SupplierPricing:
    """The saved rules; the defaults for every type that was never saved."""
    row = await session.get(SiteSetting, _key(code))
    return SupplierPricing.model_validate(row.value) if row else SupplierPricing()


async def save_supplier_pricing(session: AsyncSession, code: str, pricing: SupplierPricing) -> None:
    """The caller commits."""
    value = pricing.model_dump(mode="json")
    row = await session.get(SiteSetting, _key(code))
    if row:
        row.value = value
    else:
        session.add(SiteSetting(key=_key(code), value=value))


def can_buy_for(user: User | None, organization: Organization | None) -> bool:
    """The site sells to businesses only: a user sees prices and orders for an approved organization they are a
    member of (`members` loaded). They pay its wholesale prices; the retail ones are kept for reference."""
    return (
        user is not None
        and organization is not None
        and organization.status == OrganizationStatus.approved
        and organization.role_of(user.id) is not None
    )


# whose prices clients pay: the cart and the checkout take the audience only from here
B2B_AUDIENCE = Audience.wholesale


@dataclass(frozen=True)
class PriceBreakdown:
    """Every step of a price by the markup rules, for the admin panel's calculator."""

    markup_percent: Decimal
    markup_category: int | None  # category whose markup applied, None for the default one
    by_markup: Decimal  # supplier price * (1 + markup / 100)
    floor: Decimal  # supplier price + minimal markup in roubles
    rrp_used: bool
    before_rounding: Decimal
    price: Decimal


def price_breakdown(supplier_price: Decimal, rrp: Decimal | None, category_path: str | None, s: PriceRules) -> PriceBreakdown:
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


# (type, column) as plain strings: cheaper in the loop of the stock sync over ~170k products
_TYPE_COLUMNS = tuple((t.value, column) for t, column in PRICE_COLUMNS.items())


def compute_prices(
    supplier_price: Decimal | None,
    rrp: Decimal | None,
    category_path: str | None,
    pricing: SupplierPricing,
    overrides: dict[str, str] | None,
) -> dict[str, Decimal | None]:
    """The 4 prices of a product as {column name: price}. A fixed price of a type wins over that type's
    rules; without a supplier price only the fixed ones are known."""
    prices: dict[str, Decimal | None] = {}
    for t, column in _TYPE_COLUMNS:
        if overrides and t in overrides:
            prices[column] = Decimal(overrides[t])
        elif supplier_price is None:
            prices[column] = None
        else:
            prices[column] = price_breakdown(supplier_price, rrp, category_path, getattr(pricing, t)).price
    return prices
