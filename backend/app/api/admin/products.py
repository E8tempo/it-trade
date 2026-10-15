"""Products: prices, fixed prices, visibility; the photo processing queue."""

from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from app.api.admin.common import Money, Page, Session, like
from app.api.catalog import clear_caches
from app.api.schemas import CategoryRef
from app.config import get_settings
from app.images.processing import image_url
from app.models import Category, PriceType, Product, ProductImage
from app.models.catalog import ImageStatus
from app.pricing import DEFAULT_SUPPLIER, compute_prices, get_supplier_pricing
from app.sync.stock import recount_categories

router = APIRouter()


class AdminProduct(BaseModel):
    sku: int
    name: str
    slug: str
    vendor: str | None
    part: str | None
    category: CategoryRef | None
    supplier_price: Money | None
    rrp: Money | None
    price: Money | None  # retail cash, the shop price
    prices: dict[PriceType, Money | None]
    price_overrides: dict[PriceType, Money]  # the types whose price is fixed by admin
    markup_percent: float | None  # wholesale cashless price (what most clients pay) / supplier price - 1, %
    in_stock: bool
    qty: int
    is_hidden: bool
    is_active: bool
    image: str | None  # small thumbnail url


FixedPrice = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]  # fits Money


class ProductPatch(BaseModel):
    """Only the fields that are sent change. `price_overrides` is merged into the fixed prices: a price fixes
    that type, `null` returns the type to the markup rules."""

    price_overrides: dict[PriceType, FixedPrice | None] | None = None
    is_hidden: bool | None = None


class RequeueIn(BaseModel):
    variant: str | None = Field(None, description='Only images with this watermark variant, e.g. "small"')


class FailedImage(BaseModel):
    id: int
    sku: int
    source_url: str
    error: str | None
    attempts: int


def _out(p: Product) -> AdminProduct:
    img = p.main_image
    show = img is not None and img.status in (ImageStatus.ready, ImageStatus.stale)
    sale = p.price_wholesale_cashless
    markup = float(sale / p.supplier_price - 1) * 100 if sale and p.supplier_price else None
    return AdminProduct(
        sku=p.sku,
        name=p.name,
        slug=p.slug,
        vendor=p.vendor,
        part=p.part,
        category=CategoryRef(id=p.category.id, name=p.category.name, slug=p.category.slug) if p.category else None,
        supplier_price=p.supplier_price,
        rrp=p.rrp,
        price=p.price,
        prices={t: p.price_for(t) for t in PriceType},
        price_overrides=p.fixed_prices(),
        markup_percent=round(markup, 1) if markup is not None else None,
        in_stock=p.in_stock,
        qty=p.qty_central + p.qty_nearest,
        is_hidden=p.is_hidden,
        is_active=p.is_active,
        image=image_url(get_settings().media_url, img.id, "md", img.version) if show else None,
    )


SORTS = {
    "name": (Product.name,),
    # the site sells wholesale only: by the wholesale cashless price
    "price": (Product.price_wholesale_cashless.desc().nulls_last(),),
    "markup": ((Product.price_wholesale_cashless / Product.supplier_price).desc().nulls_last(),),
    "new": (Product.sku.desc(),),
}


@router.get("/products", response_model=Page[AdminProduct])
async def list_products(
    session: Session,
    q: str | None = None,
    category_id: int | None = None,
    in_stock: bool | None = None,
    override: bool | None = Query(None, description="Only products with (true) / without (false) a fixed price of any type"),
    hidden: bool | None = None,
    sort: Literal["name", "price", "markup", "new"] = "new",
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 50,
):
    stmt = select(Product).where(Product.is_active)
    if q and q.strip():
        stmt = stmt.where(Product.search_text.like(like(q), escape="\\"))
    if category_id is not None:
        c = await session.get(Category, category_id)
        if c is None:
            raise HTTPException(404, "Category not found")
        stmt = stmt.join(Category, Category.id == Product.category_id).where(Category.path.like(f"{c.path}%"))
    if in_stock is not None:
        stmt = stmt.where(Product.in_stock == in_stock)
    if override is not None:
        stmt = stmt.where(Product.price_overrides.is_not(None) if override else Product.price_overrides.is_(None))
    if hidden is not None:
        stmt = stmt.where(Product.is_hidden == hidden)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(
        stmt.options(selectinload(Product.category), selectinload(Product.main_image))
        .order_by(*SORTS[sort], Product.sku)
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return Page[AdminProduct](items=[_out(p) for p in rows], total=total, page=page, per_page=per_page)


@router.patch("/products/{sku}", response_model=AdminProduct)
async def update_product(sku: int, body: ProductPatch, session: Session, background: BackgroundTasks):
    p = await session.scalar(
        select(Product)
        .where(Product.sku == sku)
        .options(selectinload(Product.category), selectinload(Product.main_image))
    )
    if p is None:
        raise HTTPException(404, "Product not found")
    sent = body.model_fields_set
    if "price_overrides" in sent and body.price_overrides is not None:
        fixed = dict(p.price_overrides or {})  # a new dict: the JSON column does not notice changes in place
        for t, price in body.price_overrides.items():
            if price is None:
                fixed.pop(t.value, None)
            else:
                fixed[t.value] = str(price.quantize(Decimal("0.01")))
        p.price_overrides = fixed
        pricing = await get_supplier_pricing(session, DEFAULT_SUPPLIER)
        path = p.category.path if p.category else None
        for column, price in compute_prices(p.supplier_price, p.rrp, path, pricing, p.price_overrides).items():
            setattr(p, column, price)
    if "is_hidden" in sent and body.is_hidden is not None and body.is_hidden != p.is_hidden:
        p.is_hidden = body.is_hidden
        background.add_task(recount_categories)
    await session.commit()
    background.add_task(clear_caches)
    return _out(p)


@router.post("/images/requeue")
async def requeue_images(body: RequeueIn, session: Session) -> dict[str, int]:
    """Process ready photos again (e.g. after the watermark templates were recalibrated).
    They stay visible until the new files are written."""
    stmt = update(ProductImage).where(ProductImage.status == ImageStatus.ready).values(status=ImageStatus.stale, attempts=0)
    if body.variant:
        stmt = stmt.where(ProductImage.wm_template.like(f"{body.variant}%"))
    res = await session.execute(stmt)
    await session.commit()
    return {"queued": res.rowcount}


@router.get("/images/failed", response_model=list[FailedImage])
async def failed_images(session: Session, limit: Annotated[int, Query(ge=1, le=500)] = 100):
    rows = await session.scalars(
        select(ProductImage).where(ProductImage.status == ImageStatus.failed).order_by(ProductImage.id.desc()).limit(limit)
    )
    return [FailedImage(id=i.id, sku=i.sku, source_url=i.source_url, error=i.error, attempts=i.attempts) for i in rows]
