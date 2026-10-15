"""Commercial offers (КП) a client makes for their own customers.

The client picks our products (or takes the cart), puts their markup on top of what they pay us, and prints the
offer with their own requisites: our name, our article numbers and our prices are never on it. The lines keep what
the client pays us (`cost`, the wholesale price of the offer's payment method) as it was when the line was added or
the prices were refreshed, so an offer sent to a customer does not change by itself; the editor shows the lines
whose price has changed since.

An offer belongs to an organization (the one the user works for when making it; a private person makes none): only
people of it who may still buy for it see it, its owner all of them, a purchaser their own, like the orders.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.account import _member_of
from app.api.admin.common import Page
from app.api.cart import Problem, find_buyer, load_products, problem
from app.api.deps import CurrentUser, Session
from app.api.schemas import ImageOut
from app.models import (
    MemberRole,
    Organization,
    OrganizationMember,
    OrganizationStatus,
    PaymentMethod,
    PriceSource,
    Product,
    Quote,
    QuoteItem,
    User,
)
from app.models.base import utcnow
from app.models.catalog import VISIBLE_STATUSES, price_type
from app.models.quotes import vat_included
from app.pricing import B2B_AUDIENCE, can_buy_for

router = APIRouter(prefix="/api/quotes", tags=["quotes"])

MAX_ID = 2**31 - 1
MAX_LINES = 500
MAX_QTY = 99_999
MAX_PRICE = Decimal(10) ** 9
VAT_RATES = (5, 7, 10, 20, 22)
ROUND_STEPS = (0, 1, 10, 100)  # kopecks, roubles, tens, hundreds
NOT_FOUND = "КП не найдено"
NOT_APPROVED = "Организация ещё не подтверждена: КП откроются после проверки"
NO_ORGANIZATION = "КП составляется от организации: выберите её в шапке сайта или добавьте в разделе «Организации»"

QuoteId = Annotated[int, Path(ge=1, le=MAX_ID)]
ItemId = Annotated[int, Path(ge=1, le=MAX_ID)]
Markup = Annotated[Decimal, Field(ge=0, le=10_000, max_digits=7, decimal_places=2)]
Price = Annotated[Decimal, Field(ge=0, lt=MAX_PRICE, max_digits=12, decimal_places=2)]


def _blank_is_none(v: object) -> object:
    return None if isinstance(v, str) and not v.strip() else v


def _check_vat(v: int | None) -> int | None:
    if v is not None and v not in VAT_RATES:
        raise ValueError(f"НДС: одна из ставок {', '.join(map(str, VAT_RATES))} % или без НДС")
    return v


# --- the seller's profile -------------------------------------------------------------------


class QuoteProfile(BaseModel):
    """What an organization's offers print besides its requisites (Organization.quote_profile), and the defaults
    of a new offer."""

    model_config = ConfigDict(str_strip_whitespace=True)

    phone: str | None = Field(None, max_length=64)
    email: str | None = Field(None, max_length=254)
    website: str | None = Field(None, max_length=128)
    bank_name: str | None = Field(None, max_length=255)
    bik: str | None = Field(None, pattern=r"^\d{9}$")
    account: str | None = Field(None, pattern=r"^\d{20}$")  # расчётный счёт
    corr_account: str | None = Field(None, pattern=r"^\d{20}$")  # корреспондентский счёт
    signer_title: str | None = Field(None, max_length=128)  # «Генеральный директор»
    signer_name: str | None = Field(None, max_length=128)  # «Иванов И. И.»
    # a new offer starts with these
    markup_percent: Markup = Decimal(20)
    vat_rate: int | None = None
    valid_days: int | None = Field(10, ge=1, le=365)  # valid for so many days from the day it is made
    terms: str | None = Field(None, max_length=4000)

    @field_validator("phone", "email", "website", "bank_name", "signer_title", "signer_name", "terms", mode="before")
    @classmethod
    def _blank(cls, v: object) -> object:
        return _blank_is_none(v)

    @field_validator("bik", "account", "corr_account", mode="before")
    @classmethod
    def _digits(cls, v: object) -> object:
        return ("".join(v.split()) or None) if isinstance(v, str) else v

    @field_validator("vat_rate")
    @classmethod
    def _vat(cls, v: int | None) -> int | None:
        return _check_vat(v)

    @classmethod
    def of(cls, org: Organization) -> "QuoteProfile":
        return cls.model_validate(org.quote_profile or {})


class ProfileOut(QuoteProfile):
    can_edit: bool  # the head of the organization edits it, its purchasers only read it


# --- output ---------------------------------------------------------------------------------


class SellerOut(BaseModel):
    """The organization offering, as printed, with the person who made the offer."""

    name: str
    inn: str
    kpp: str | None
    ogrn: str | None
    address: str | None
    profile: QuoteProfile
    author_name: str | None
    author_email: str | None
    author_phone: str | None


class QuoteLineOut(BaseModel):
    id: int
    sku: int | None  # None: the client's own line
    name: str
    vendor: str | None
    part: str | None
    unit: str
    qty: int
    slug: str | None  # product page, while it is sold
    image: ImageOut | None
    cost: float | None  # what the client pays us per unit (when the line was added or refreshed)
    rrp: float | None
    markup_percent: float | None  # the line's own, None: the offer's
    price: float | None  # typed in
    sale_price: float | None  # per unit, on the offer
    price_source: PriceSource | None
    total: float | None
    profit: float | None  # (sale - cost) * qty, for products
    current_cost: float | None  # what the client would pay us now; differs from `cost` when the prices changed
    stock: int
    problem: Problem | None  # why we cannot sell the product now


class QuoteTotals(BaseModel):
    total: float  # the lines with a selling price
    cost: float  # what the client pays us for them
    profit: float  # total - cost: the client's own lines count in full
    vat: float | None  # included in the total
    units: int
    unpriced: int  # lines without a selling price: not in the total
    changed: int  # product lines whose price has changed since
    problems: int  # product lines we cannot sell now


class QuoteListItem(BaseModel):
    id: int
    number: int
    title: str | None
    customer: str | None
    organization_name: str
    author_name: str | None
    created_at: datetime
    updated_at: datetime
    lines: int
    total: float


class QuoteOut(BaseModel):
    id: int
    number: int
    organization_id: int
    title: str | None
    customer: str | None
    customer_contact: str | None
    payment: PaymentMethod
    markup_percent: float
    use_rrp: bool
    round_to: int
    vat_rate: int | None
    valid_until: date | None
    terms: str | None
    show_photos: bool
    created_at: datetime
    updated_at: datetime
    seller: SellerOut
    items: list[QuoteLineOut]
    totals: QuoteTotals


def _money(x: Decimal | None) -> float | None:
    return float(x) if x is not None else None


def _current_cost(p: Product | None, payment: PaymentMethod) -> Decimal | None:
    sold = p is not None and p.is_active and not p.is_hidden
    return p.price_for(price_type(B2B_AUDIENCE, payment)) if sold else None


async def _out(session: AsyncSession, q: Quote) -> QuoteOut:
    products = await load_products(session, {i.sku for i in q.items if i.sku is not None})
    author = await session.get(User, q.user_id) if q.user_id is not None else None
    lines, total, cost, units, unpriced, changed, problems = [], Decimal(0), Decimal(0), 0, 0, 0, 0
    for i in q.items:
        p = products.get(i.sku) if i.sku is not None else None
        sale, source = i.sale()
        now = _current_cost(p, q.payment) if i.sku is not None else None
        line_problem = problem(p, now) if i.sku is not None else None
        img = p.main_image if p is not None else None
        line_total = sale * i.qty if sale is not None else None
        profit = (sale - i.cost) * i.qty if sale is not None and i.cost is not None else None
        units += i.qty
        if line_total is None:
            unpriced += 1
        else:
            total += line_total
            cost += (i.cost or 0) * i.qty
        if i.sku is not None and now != i.cost:
            changed += 1
        if line_problem:
            problems += 1
        lines.append(
            QuoteLineOut(
                id=i.id,
                sku=i.sku,
                name=i.name,
                vendor=i.vendor,
                part=i.part,
                unit=i.unit,
                qty=i.qty,
                slug=p.slug if p is not None and p.is_active and not p.is_hidden else None,
                image=ImageOut.of(img) if img is not None and img.status in VISIBLE_STATUSES else None,
                cost=_money(i.cost),
                rrp=_money(i.rrp),
                markup_percent=_money(i.markup_percent),
                price=_money(i.price),
                sale_price=_money(sale),
                price_source=source,
                total=_money(line_total),
                profit=_money(profit),
                current_cost=_money(now),
                stock=p.qty_central + p.qty_nearest if p is not None else 0,
                problem=line_problem,
            )
        )
    org = q.organization
    return QuoteOut(
        id=q.id,
        number=q.number,
        organization_id=q.organization_id,
        title=q.title,
        customer=q.customer,
        customer_contact=q.customer_contact,
        payment=q.payment,
        markup_percent=float(q.markup_percent),
        use_rrp=q.use_rrp,
        round_to=q.round_to,
        vat_rate=q.vat_rate,
        valid_until=q.valid_until,
        terms=q.terms,
        show_photos=q.show_photos,
        created_at=q.created_at,
        updated_at=q.updated_at,
        seller=SellerOut(
            name=org.name,
            inn=org.inn,
            kpp=org.kpp,
            ogrn=org.ogrn,
            address=org.address,
            profile=QuoteProfile.of(org),
            author_name=author.full_name if author else None,
            author_email=author.email if author else None,
            author_phone=author.phone if author else None,
        ),
        items=lines,
        totals=QuoteTotals(
            total=float(total),
            cost=float(cost),
            profit=float(total - cost),
            vat=_money(vat_included(total, q.vat_rate)),
            units=units,
            unpriced=unpriced,
            changed=changed,
            problems=problems,
        ),
    )


# --- finding and changing offers ------------------------------------------------------------


def _visible(user: User):
    """Offers a user sees: of the approved organizations they work for, their own and every one of those they head."""
    member = select(OrganizationMember.organization_id).where(OrganizationMember.user_id == user.id)
    headed = member.where(OrganizationMember.role == MemberRole.owner)
    approved = select(Organization.id).where(Organization.status == OrganizationStatus.approved)
    return (
        Quote.organization_id.in_(member)
        & Quote.organization_id.in_(approved)
        & or_(Quote.user_id == user.id, Quote.organization_id.in_(headed))
    )


async def _get(session: AsyncSession, user: User, quote_id: int) -> Quote:
    q = await session.scalar(
        select(Quote)
        .where(Quote.id == quote_id, _visible(user))
        .options(selectinload(Quote.items), selectinload(Quote.organization).selectinload(Organization.members))
    )
    if q is None or not can_buy_for(user, q.organization):
        raise HTTPException(404, NOT_FOUND)
    return q


def _touch(q: Quote) -> None:
    q.updated_at = utcnow()


def _snapshot(item: QuoteItem, p: Product | None, payment: PaymentMethod) -> None:
    """The product's data and what the client pays us for it now (None while it is not sold)."""
    item.cost = _current_cost(p, payment)
    if p is not None:
        item.vendor, item.part, item.rrp = p.vendor, p.part, p.rrp


async def _refresh(session: AsyncSession, q: Quote) -> None:
    products = await load_products(session, {i.sku for i in q.items if i.sku is not None})
    for i in q.items:
        if i.sku is not None:
            _snapshot(i, products.get(i.sku), q.payment)


def _product_line(p: Product, qty: int, payment: PaymentMethod) -> QuoteItem:
    item = QuoteItem(sku=p.sku, name=p.name, qty=qty)
    _snapshot(item, p, payment)
    return item


async def _next_number(session: AsyncSession, org_id: int) -> int:
    last = await session.scalar(select(func.max(Quote.number)).where(Quote.organization_id == org_id))
    return (last or 0) + 1


async def _save_new(session: AsyncSession, q: Quote) -> Quote:
    """Adds an offer with the organization's next number; another one made at the same moment takes the number,
    this one tries the next."""
    for attempt in range(5):
        q.number = await _next_number(session, q.organization_id)
        session.add(q)
        try:
            await session.commit()
            break
        except IntegrityError:
            await session.rollback()
            if attempt == 4:
                raise
    return await _get_by_id(session, q.id)


async def _get_by_id(session: AsyncSession, quote_id: int) -> Quote:
    """The offer as saved, its lines in their order."""
    return await session.scalar(
        select(Quote)
        .where(Quote.id == quote_id)
        .options(selectinload(Quote.items), selectinload(Quote.organization).selectinload(Organization.members))
        .execution_options(populate_existing=True)
    )


def _renumber(q: Quote) -> None:
    for n, i in enumerate(q.items):
        i.position = n


# --- input ----------------------------------------------------------------------------------


class QuoteIn(BaseModel):
    from_cart: bool = False  # the lines of the user's cart
    payment: PaymentMethod | None = None  # whose prices are the costs; the cart's choice when it is taken
    title: str | None = Field(None, max_length=255)
    customer: str | None = Field(None, max_length=255)


class QuotePatch(BaseModel):
    """The fields to change; the others are left as they are."""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(None, max_length=255)
    customer: str | None = Field(None, max_length=255)
    customer_contact: str | None = Field(None, max_length=255)
    payment: PaymentMethod | None = None
    markup_percent: Markup | None = None
    use_rrp: bool | None = None
    round_to: int | None = None
    vat_rate: int | None = None
    valid_until: date | None = None
    terms: str | None = Field(None, max_length=4000)
    show_photos: bool | None = None

    @field_validator("title", "customer", "customer_contact", "terms", mode="before")
    @classmethod
    def _blank(cls, v: object) -> object:
        return _blank_is_none(v)

    @field_validator("round_to")
    @classmethod
    def _round(cls, v: int | None) -> int | None:
        if v is not None and v not in ROUND_STEPS:
            raise ValueError("Округление: до копеек, рубля, десятков или сотен рублей")
        return v

    @field_validator("vat_rate")
    @classmethod
    def _vat(cls, v: int | None) -> int | None:
        return _check_vat(v)


class LineIn(BaseModel):
    """A product of the catalog (`sku`), or the client's own line: a name and a price."""

    model_config = ConfigDict(str_strip_whitespace=True)

    sku: int | None = Field(None, ge=1, le=MAX_ID)
    qty: int = Field(1, ge=1, le=MAX_QTY)
    name: str | None = Field(None, max_length=1024)
    unit: str | None = Field(None, max_length=16)
    price: Price | None = None

    @field_validator("name", "unit", mode="before")
    @classmethod
    def _blank(cls, v: object) -> object:
        return _blank_is_none(v)


class LinesIn(BaseModel):
    items: list[LineIn] = Field(min_length=1, max_length=MAX_LINES)


class LinePatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    qty: int | None = Field(None, ge=1, le=MAX_QTY)
    name: str | None = Field(None, min_length=1, max_length=1024)
    unit: str | None = Field(None, min_length=1, max_length=16)
    markup_percent: Markup | None = None  # null: the offer's
    price: Price | None = None  # null: by the markup (or the RRP)
    position: int | None = Field(None, ge=0, le=MAX_LINES)  # move the line to this place


# --- endpoints ------------------------------------------------------------------------------


@router.get("", response_model=Page[QuoteListItem])
async def my_quotes(
    user: CurrentUser,
    session: Session,
    response: Response,
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
    per_page: Annotated[int, Query(ge=1, le=50)] = 20,
):
    """The offers the user sees, the last changed first."""
    stmt = select(Quote).where(_visible(user))
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        await session.scalars(
            stmt.options(selectinload(Quote.items), selectinload(Quote.organization))
            .order_by(Quote.updated_at.desc(), Quote.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    )
    authors = {u.id: u for u in await session.scalars(select(User).where(User.id.in_({q.user_id for q in rows if q.user_id})))}
    items = []
    for q in rows:
        sales = ((sale, i.qty) for i in q.items if (sale := i.sale()[0]) is not None)
        author = authors.get(q.user_id)
        items.append(
            QuoteListItem(
                id=q.id,
                number=q.number,
                title=q.title,
                customer=q.customer,
                organization_name=q.organization.name,
                author_name=(author.full_name or author.email) if author else None,
                created_at=q.created_at,
                updated_at=q.updated_at,
                lines=len(q.items),
                total=float(sum((sale * qty for sale, qty in sales), Decimal(0))),
            )
        )
    response.headers["Cache-Control"] = "no-store"
    return Page[QuoteListItem](items=items, total=total, page=page, per_page=per_page)


@router.post("", response_model=QuoteOut, status_code=status.HTTP_201_CREATED)
async def create_quote(body: QuoteIn, user: CurrentUser, session: Session):
    """A new offer of the organization the user works for now (the cart's), with the defaults of its profile;
    `from_cart` takes the cart's products (those we sell)."""
    b = await find_buyer(session, user)
    org = b.organization
    if org is None:
        raise HTTPException(409, NO_ORGANIZATION)
    profile = QuoteProfile.of(org)
    payment = body.payment or PaymentMethod.cashless
    q = Quote(
        organization_id=org.id,
        user_id=user.id,
        title=body.title,
        customer=body.customer,
        payment=payment,
        markup_percent=profile.markup_percent,
        vat_rate=profile.vat_rate,
        valid_until=date.today() + timedelta(days=profile.valid_days) if profile.valid_days else None,
        terms=profile.terms,
        items=[],
    )
    if body.from_cart:
        cart_items = list(b.cart.items) if b.cart else []
        if not cart_items:
            raise HTTPException(409, "Корзина пуста")
        products = await load_products(session, {i.sku for i in cart_items})
        for i in cart_items:
            p = products.get(i.sku)
            if p is not None and p.is_active and not p.is_hidden:
                q.items.append(_product_line(p, i.qty, payment))
        _renumber(q)
    q = await _save_new(session, q)
    return await _out(session, q)


@router.get("/{quote_id}", response_model=QuoteOut)
async def get_quote(quote_id: QuoteId, user: CurrentUser, session: Session, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await _out(session, await _get(session, user, quote_id))


@router.patch("/{quote_id}", response_model=QuoteOut)
async def edit_quote(quote_id: QuoteId, body: QuotePatch, user: CurrentUser, session: Session):
    """Changes the given fields. Another payment method takes the costs of its prices."""
    q = await _get(session, user, quote_id)
    data = body.model_dump(exclude_unset=True)
    for key in ("payment", "markup_percent", "use_rrp", "round_to", "show_photos"):
        if key in data and data[key] is None:
            raise HTTPException(422, "Поле нельзя очистить")
    payment_changed = "payment" in data and data["payment"] != q.payment
    for key, value in data.items():
        setattr(q, key, value)
    if payment_changed:
        await _refresh(session, q)
    _touch(q)
    await session.commit()
    return await _out(session, await _get_by_id(session, q.id))


@router.delete("/{quote_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quote(quote_id: QuoteId, user: CurrentUser, session: Session):
    await session.delete(await _get(session, user, quote_id))
    await session.commit()


@router.post("/{quote_id}/copy", response_model=QuoteOut, status_code=status.HTTP_201_CREATED)
async def copy_quote(quote_id: QuoteId, user: CurrentUser, session: Session):
    """A new offer like this one, at today's prices, made by the user."""
    src = await _get(session, user, quote_id)
    profile = QuoteProfile.of(src.organization)
    q = Quote(
        organization_id=src.organization_id,
        user_id=user.id,
        **{
            k: getattr(src, k)
            for k in ("title", "customer", "customer_contact", "payment", "markup_percent", "use_rrp", "round_to", "vat_rate", "terms", "show_photos")
        },
        valid_until=date.today() + timedelta(days=profile.valid_days) if profile.valid_days else None,
        items=[
            QuoteItem(
                position=i.position, sku=i.sku, name=i.name, vendor=i.vendor, part=i.part, unit=i.unit, qty=i.qty,
                cost=i.cost, rrp=i.rrp, markup_percent=i.markup_percent, price=i.price,
            )
            for i in src.items
        ],
    )
    await _refresh(session, q)
    q = await _save_new(session, q)
    return await _out(session, q)


@router.post("/{quote_id}/refresh", response_model=QuoteOut)
async def refresh_prices(quote_id: QuoteId, user: CurrentUser, session: Session):
    """Takes what the client pays us now for every product (and its RRP); prices typed in stay."""
    q = await _get(session, user, quote_id)
    await _refresh(session, q)
    _touch(q)
    await session.commit()
    return await _out(session, await _get_by_id(session, q.id))


@router.post("/{quote_id}/items", response_model=QuoteOut)
async def add_lines(quote_id: QuoteId, body: LinesIn, user: CurrentUser, session: Session):
    """Adds products (a product already there gets the quantity added) and the client's own lines. A product
    that is out of stock can be offered too: the editor marks it."""
    q = await _get(session, user, quote_id)
    products = await load_products(session, {i.sku for i in body.items if i.sku is not None})
    by_sku = {i.sku: i for i in q.items if i.sku is not None}
    for line in body.items:
        if line.sku is not None:
            p = products.get(line.sku)
            if p is None or not p.is_active or p.is_hidden:
                raise HTTPException(422, f"Товар {line.sku} не найден или больше не продаётся")
            if (have := by_sku.get(line.sku)) is not None:
                have.qty = min(MAX_QTY, have.qty + line.qty)
                continue
            item = _product_line(p, line.qty, q.payment)
            by_sku[p.sku] = item
        else:
            if not line.name or line.price is None:
                raise HTTPException(422, "У своей строки нужны название и цена")
            item = QuoteItem(name=line.name, qty=line.qty, price=line.price)
        if line.unit:
            item.unit = line.unit
        item.position = len(q.items)
        q.items.append(item)
    if len(q.items) > MAX_LINES:
        raise HTTPException(409, f"В КП не больше {MAX_LINES} строк")
    _touch(q)
    await session.commit()
    return await _out(session, await _get_by_id(session, q.id))


@router.patch("/{quote_id}/items/{item_id}", response_model=QuoteOut)
async def edit_line(quote_id: QuoteId, item_id: ItemId, body: LinePatch, user: CurrentUser, session: Session):
    q = await _get(session, user, quote_id)
    item = next((i for i in q.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(404, "Строка не найдена")
    data = body.model_dump(exclude_unset=True)
    for key in ("qty", "name", "unit", "position"):
        if key in data and data[key] is None:
            raise HTTPException(422, "Поле нельзя очистить")
    if "price" in data and data["price"] is None and item.sku is None:
        raise HTTPException(422, "У своей строки нужна цена")
    position = data.pop("position", None)
    for key, value in data.items():
        setattr(item, key, value)
    if position is not None:
        q.items.remove(item)
        q.items.insert(min(position, len(q.items)), item)
        _renumber(q)
    _touch(q)
    await session.commit()
    return await _out(session, await _get_by_id(session, q.id))


@router.delete("/{quote_id}/items/{item_id}", response_model=QuoteOut)
async def remove_line(quote_id: QuoteId, item_id: ItemId, user: CurrentUser, session: Session):
    q = await _get(session, user, quote_id)
    item = next((i for i in q.items if i.id == item_id), None)
    if item is not None:
        q.items.remove(item)
        _renumber(q)
        _touch(q)
        await session.commit()
    return await _out(session, await _get_by_id(session, q.id))


# --- the profile ----------------------------------------------------------------------------

OrgId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/profile/{org_id}", response_model=ProfileOut)
async def get_profile(org_id: OrgId, user: CurrentUser, session: Session, response: Response):
    org = await _member_of(session, user, org_id)
    if not can_buy_for(user, org):
        raise HTTPException(403, NOT_APPROVED)
    response.headers["Cache-Control"] = "no-store"
    return ProfileOut(**QuoteProfile.of(org).model_dump(), can_edit=org.role_of(user.id) == MemberRole.owner)


@router.put("/profile/{org_id}", response_model=ProfileOut)
async def save_profile(org_id: OrgId, body: QuoteProfile, user: CurrentUser, session: Session):
    """The head of the organization only."""
    org = await _member_of(session, user, org_id, owner=True)
    if not can_buy_for(user, org):
        raise HTTPException(403, NOT_APPROVED)
    org.quote_profile = body.model_dump(mode="json")
    await session.commit()
    return ProfileOut(**body.model_dump(), can_edit=True)
