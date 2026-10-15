"""Markup rules: price calculator, impact of new rules before saving them, categories."""

from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.admin.common import Money, Session
from app.api.admin.suppliers import supplier_or_404
from app.api.catalog import clear_caches
from app.api.schemas import CategoryRef
from app.models import Audience, Category, PriceType, Product
from app.models.catalog import PRICE_COLUMNS, price_type
from app.pricing import DEFAULT_SUPPLIER, PriceRules, SupplierPricing, compute_prices, get_supplier_pricing, price_breakdown

router = APIRouter()


class PreviewIn(BaseModel):
    supplier: str = Field(DEFAULT_SUPPLIER, max_length=32)
    price_type: PriceType = PriceType.retail_cash
    settings: PriceRules | None = Field(None, description="Rules to try for `price_type`; the saved ones if omitted")
    supplier_price: Decimal = Field(gt=0)
    rrp: Decimal | None = Field(None, gt=0)
    category_id: int | None = None


class PreviewOut(BaseModel):
    markup_percent: Money
    markup_category: CategoryRef | None
    by_markup: Money
    floor: Money
    rrp_used: bool
    before_rounding: Money
    price: Money
    margin: Money
    margin_percent: Money
    category_path: list[CategoryRef]
    by_type: dict[PriceType, Money]  # the same product priced by every type (the tried rules for `price_type`)


class ImpactIn(BaseModel):
    supplier: str = Field(DEFAULT_SUPPLIER, max_length=32)
    price_type: PriceType = PriceType.retail_cash
    settings: PriceRules


class PriceChange(BaseModel):
    sku: int
    name: str
    supplier_price: Money
    before: Money | None
    after: Money


class ImpactOut(BaseModel):
    products: int  # priced by the rules of the type (with a supplier price and without a fixed price of the type)
    changed: int
    up: int
    down: int
    avg_markup_before: float  # %, mean of price / supplier price - 1
    avg_markup_after: float
    examples: list[PriceChange]  # the largest changes
    by_rrp: int  # of `products`: priced at the supplier's RRP rather than by the markup
    fixed: int  # left out: the price of the type is fixed by admin
    # wholesale types: products whose new price is above their current retail price of the same payment method
    above_retail: int | None


class CategoryOut(BaseModel):
    id: int
    parent_id: int | None
    name: str
    depth: int
    product_count: int
    is_hidden: bool


class CategoryPatch(BaseModel):
    is_hidden: bool


async def _path(session: Session, category_id: int | None) -> tuple[str | None, list[CategoryRef]]:
    if category_id is None:
        return None, []
    c = await session.get(Category, category_id)
    if c is None:
        raise HTTPException(404, "Category not found")
    ids = [int(x) for x in c.path.strip("/").split("/") if x]
    names = {x.id: x for x in await session.scalars(select(Category).where(Category.id.in_(ids)))}
    return c.path, [CategoryRef(id=i, name=names[i].name, slug=names[i].slug) for i in ids if i in names]


async def _pricing(session: Session, supplier: str, t: PriceType, rules: PriceRules | None) -> SupplierPricing:
    """The supplier's saved rules, with `rules` tried for type `t` instead of the saved ones."""
    supplier_or_404(supplier)
    pricing = await get_supplier_pricing(session, supplier)
    return pricing.model_copy(update={t.value: rules}) if rules is not None else pricing


@router.post("/pricing/preview", response_model=PreviewOut)
async def preview(body: PreviewIn, session: Session):
    pricing = await _pricing(session, body.supplier, body.price_type, body.settings)
    path, chain = await _path(session, body.category_id)
    b = price_breakdown(body.supplier_price, body.rrp, path, pricing.rules(body.price_type))
    margin = b.price - body.supplier_price
    prices = compute_prices(body.supplier_price, body.rrp, path, pricing, None)
    return PreviewOut(
        **{k: getattr(b, k) for k in ("markup_percent", "by_markup", "floor", "rrp_used", "before_rounding", "price")},
        markup_category=next((c for c in chain if c.id == b.markup_category), None),
        margin=margin,
        margin_percent=(margin / body.supplier_price * 100).quantize(Decimal("0.1")),
        category_path=chain,
        by_type={t: prices[column] for t, column in PRICE_COLUMNS.items()},
    )


@router.post("/pricing/impact", response_model=ImpactOut)
async def impact(body: ImpactIn, session: Session):
    supplier_or_404(body.supplier)
    t = body.price_type
    current = getattr(Product, PRICE_COLUMNS[t])
    retail = getattr(Product, PRICE_COLUMNS[price_type(Audience.retail, t.payment)])
    rows = (
        await session.execute(
            select(Product.sku, Product.name, Product.supplier_price, Product.rrp, current, retail, Product.price_overrides)
            .add_columns(Category.path)
            .outerjoin(Category, Category.id == Product.category_id)
            .where(Product.supplier_price.is_not(None))
        )
    ).all()
    changes, before_m, after_m = [], [], []
    products = up = down = above = by_rrp = fixed = 0
    for sku, name, sp, rrp, price, retail_price, overrides, path in rows:
        if overrides and t in overrides:
            fixed += 1  # the price of this type is fixed by admin
            continue
        products += 1
        b = price_breakdown(sp, rrp, path, body.settings)
        new = b.price
        by_rrp += b.rrp_used
        if price is not None:
            before_m.append(float(price / sp - 1))
        after_m.append(float(new / sp - 1))
        if price != new:
            up += price is None or new > price
            down += price is not None and new < price
            changes.append(PriceChange(sku=sku, name=name, supplier_price=sp, before=price, after=new))
        above += retail_price is not None and new > retail_price
    changes.sort(key=lambda c: -abs(c.after - (c.before or c.after)))
    return ImpactOut(
        products=products,
        changed=len(changes),
        up=up,
        down=down,
        avg_markup_before=round(100 * sum(before_m) / len(before_m), 1) if before_m else 0.0,
        avg_markup_after=round(100 * sum(after_m) / len(after_m), 1) if after_m else 0.0,
        examples=changes[:10],
        by_rrp=by_rrp,
        fixed=fixed,
        above_retail=above if t.audience == Audience.wholesale else None,
    )


def _category(c: Category) -> CategoryOut:
    return CategoryOut(
        id=c.id, parent_id=c.parent_id, name=c.name, depth=c.depth, product_count=c.product_count, is_hidden=c.is_hidden
    )


@router.get("/categories", response_model=list[CategoryOut])
async def categories(session: Session):
    """All active categories, parents before children (the admin builds the tree)."""
    rows = await session.scalars(select(Category).where(Category.is_active).order_by(Category.depth, Category.position))
    return [_category(c) for c in rows]


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, body: CategoryPatch, session: Session, background: BackgroundTasks):
    c = await session.get(Category, category_id)
    if c is None:
        raise HTTPException(404, "Category not found")
    c.is_hidden = body.is_hidden
    await session.commit()
    background.add_task(clear_caches)
    return _category(c)
