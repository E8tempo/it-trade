import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Select, and_, case, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.schemas import (
    CategoryDetail,
    CategoryNode,
    CategoryRef,
    ImageOut,
    ProductCard,
    ProductDetail,
    ProductPage,
    VendorFacet,
)
from app.db import get_session
from app.models import Category, Product, ProductImage
from app.models.catalog import VISIBLE_STATUSES, ImageStatus
from app.site_settings import ShopSettings, get_settings_obj

router = APIRouter(prefix="/api", tags=["catalog"])
Session = Annotated[AsyncSession, Depends(get_session)]

_tree_cache: tuple[float, list[CategoryNode]] | None = None
TREE_TTL = 60.0


async def _visible_categories(session: AsyncSession) -> list[Category]:
    shop = await get_settings_obj(session, ShopSettings)
    q = select(Category).where(Category.is_active, ~Category.is_hidden).order_by(Category.depth, Category.position)
    if not shop.show_out_of_stock:
        q = q.where(Category.product_count > 0)
    return list((await session.scalars(q)).all())


def _build_tree(cats: list[Category]) -> list[CategoryNode]:
    nodes = {c.id: CategoryNode(id=c.id, name=c.name, slug=c.slug, product_count=c.product_count) for c in cats}
    roots: list[CategoryNode] = []
    for c in cats:
        parent = nodes.get(c.parent_id) if c.parent_id else None
        if c.parent_id and parent is None:
            continue  # parent is hidden -> hide the branch
        (parent.children if parent else roots).append(nodes[c.id])
    return roots


def _trim(nodes: list[CategoryNode], depth: int) -> list[CategoryNode]:
    return [n.model_copy(update={"children": _trim(n.children, depth - 1) if depth > 1 else []}) for n in nodes]


async def _full_tree(session: AsyncSession) -> list[CategoryNode]:
    global _tree_cache
    if _tree_cache and time.monotonic() - _tree_cache[0] < TREE_TTL:
        return _tree_cache[1]
    tree = _build_tree(await _visible_categories(session))
    _tree_cache = (time.monotonic(), tree)
    return tree


@router.get("/categories", response_model=list[CategoryNode])
async def category_tree(session: Session, depth: Annotated[int | None, Query(ge=1, le=10)] = None):
    """Visible category tree; `depth` limits the number of levels (e.g. 2 for a menu)."""
    tree = await _full_tree(session)
    return _trim(tree, depth) if depth else tree


async def _breadcrumbs(session: AsyncSession, path: str) -> list[CategoryRef]:
    ids = [int(x) for x in path.strip("/").split("/") if x]
    cats = {c.id: c for c in (await session.scalars(select(Category).where(Category.id.in_(ids)))).all()}
    return [CategoryDetail.ref(cats[i]) for i in ids if i in cats]


@router.get("/categories/{category_id}", response_model=CategoryDetail)
async def category_detail(category_id: int, session: Session):
    c = await session.get(Category, category_id)
    if not c or not c.is_active or c.is_hidden:
        raise HTTPException(404, "Category not found")
    tree = await _full_tree(session)

    def find(nodes: list[CategoryNode]) -> CategoryNode | None:
        for n in nodes:
            if n.id == category_id:
                return n
            if (m := find(n.children)) is not None:
                return m
        return None

    node = find(tree)
    return CategoryDetail(
        id=c.id,
        name=c.name,
        slug=c.slug,
        product_count=c.product_count,
        breadcrumbs=await _breadcrumbs(session, c.path),
        children=node.children if node else [],
    )


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(
    q: str | None, category: int | None, category_path: str | None, vendors: list[str], in_stock: bool
) -> Select:
    stmt = select(Product).where(Product.is_active)
    if in_stock:
        stmt = stmt.where(Product.in_stock)
    if category_path:
        sub = select(Category.id).where(Category.path.like(_escape_like(category_path) + "%", escape="\\"))
        stmt = stmt.where(Product.category_id.in_(sub))
    elif category:
        stmt = stmt.where(Product.category_id == category)
    for token in (q or "").lower().split()[:8]:
        stmt = stmt.where(Product.search_text.like(f"%{_escape_like(token)}%", escape="\\"))
    if vendors:
        stmt = stmt.where(Product.vendor.in_(vendors))
    return stmt


SORTS = {
    "popular": (Product.in_stock.desc(), (Product.qty_central + Product.qty_nearest).desc(), Product.sku.desc()),
    "price_asc": (Product.in_stock.desc(), Product.price.asc().nulls_last(), Product.sku),
    "price_desc": (Product.in_stock.desc(), Product.price.desc().nulls_last(), Product.sku),
    "new": (Product.in_stock.desc(), Product.sku.desc()),
    "name": (Product.name, Product.sku),
}


@router.get("/products", response_model=ProductPage)
async def products(
    session: Session,
    q: Annotated[str | None, Query(max_length=200)] = None,
    category: int | None = None,
    vendor: Annotated[list[str], Query()] = [],  # noqa: B006 - FastAPI query list
    min_price: float | None = None,
    max_price: float | None = None,
    sort: Literal["popular", "price_asc", "price_desc", "new", "name"] = "popular",
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
    per_page: Annotated[int, Query(ge=1, le=96)] = 24,
    with_image: bool = False,  # only products whose main photo is ready (showcases)
    exclude: int | None = None,  # e.g. the current product in "similar products"
    facets: bool = True,  # vendors and price range; off for search suggestions
):
    shop = await get_settings_obj(session, ShopSettings)
    path = None
    if category is not None:
        c = await session.get(Category, category)
        if not c:
            raise HTTPException(404, "Category not found")
        path = c.path
    vendors, pmin, pmax = await _facets(session, q, category, path, not shop.show_out_of_stock) if facets else ([], None, None)

    stmt = _filtered(q, category, path, vendor, not shop.show_out_of_stock)
    if min_price is not None:
        stmt = stmt.where(Product.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Product.price <= max_price)
    if with_image:
        stmt = stmt.where(
            exists().where(ProductImage.id == Product.main_image_id, ProductImage.status.in_(VISIBLE_STATUSES))
        )
    if exclude is not None:
        stmt = stmt.where(Product.sku != exclude)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))

    order = SORTS[sort]
    if q and sort == "popular":
        exact = q.strip().lower()
        order = (case((func.lower(Product.part) == exact, 0), else_=1), *order)
    img = aliased(ProductImage)
    rows = (
        await session.execute(
            stmt.add_columns(img)
            .outerjoin(img, and_(img.id == Product.main_image_id, img.status.in_(VISIBLE_STATUSES)))
            .order_by(*order)
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()
    return ProductPage(
        items=[ProductCard.of(p, i) for p, i in rows],
        total=total or 0,
        page=page,
        per_page=per_page,
        vendors=vendors,
        price_min=pmin,
        price_max=pmax,
    )


_facet_cache: dict[tuple, tuple[float, tuple[list[VendorFacet], float | None, float | None]]] = {}
FACET_TTL = 300.0


async def _facets(
    session: AsyncSession, q: str | None, category: int | None, path: str | None, in_stock: bool
) -> tuple[list[VendorFacet], float | None, float | None]:
    """Vendors and price range of the search/category, before vendor and price filters (cached)."""
    key = ((q or "").strip().lower(), category, in_stock)
    now = time.monotonic()
    if (hit := _facet_cache.get(key)) and now - hit[0] < FACET_TTL:
        return hit[1]
    sub = _filtered(q, category, path, [], in_stock).subquery()
    rows = (
        await session.execute(
            select(sub.c.vendor, func.count(), func.min(sub.c.price), func.max(sub.c.price)).group_by(sub.c.vendor)
        )
    ).all()
    vendors = sorted((VendorFacet(name=v, count=n) for v, n, _, _ in rows if v), key=lambda f: -f.count)[:50]
    mins = [float(r[2]) for r in rows if r[2] is not None]
    maxs = [float(r[3]) for r in rows if r[3] is not None]
    result = (vendors, min(mins, default=None), max(maxs, default=None))
    if len(_facet_cache) > 2000:
        _facet_cache.clear()
    _facet_cache[key] = (now, result)
    return result


@router.get("/products/{sku}", response_model=ProductDetail)
async def product_detail(sku: int, session: Session):
    p = await session.get(Product, sku)
    if not p or not p.is_active:
        raise HTTPException(404, "Product not found")
    images = (
        await session.scalars(
            select(ProductImage)
            .where(ProductImage.sku == sku, ProductImage.status != ImageStatus.failed)
            .order_by(ProductImage.position)
        )
    ).all()
    cat = await session.get(Category, p.category_id) if p.category_id else None
    card = ProductCard.of(p, images[0] if images else None)
    return ProductDetail(
        **card.model_dump(exclude={"image"}),
        image=card.image,
        description=p.description,
        barcodes=[b for b in (p.barcodes or "").split(",") if b],
        weight=p.weight,
        volume=p.volume,
        warranty_months=p.warranty_months,
        multiplicity=p.multiplicity,
        delivery_days=p.delivery_days,
        category=CategoryDetail.ref(cat) if cat else None,
        breadcrumbs=await _breadcrumbs(session, cat.path) if cat else [],
        images=[ImageOut.of(i) for i in images],
    )


@router.get("/shop", response_model=ShopSettings)
async def shop_info(session: Session):
    return await get_settings_obj(session, ShopSettings)
