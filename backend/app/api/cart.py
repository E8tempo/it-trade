"""The cart of a client's user.

The cart is priced for whoever the user buys as now (chosen in the site header, kept on the cart): an approved
organization of theirs, at the wholesale prices, or themselves as a private person, at the retail ones; either for
the chosen payment method. An organization wins over the person unless the user chose the person. Guests get 401.
Reads never create a cart, the first change does.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, Session
from app.api.schemas import ImageOut
from app.models import (
    Audience,
    Cart,
    CartItem,
    Organization,
    OrganizationMember,
    OrganizationStatus,
    PaymentMethod,
    PriceType,
    Product,
    User,
)
from app.models.base import utcnow
from app.models.catalog import VISIBLE_STATUSES, price_type
from app.pricing import audience_of, can_buy_for

router = APIRouter(prefix="/api/cart", tags=["cart"])

MAX_QTY = 99_999  # per line
MAX_LINES = 1000
MAX_SKU = 2**31 - 1  # products.sku is a 32-bit integer

Problem = Literal["not_found", "out_of_stock", "no_price"]
PROBLEM_TEXT: dict[str, str] = {
    "not_found": "Товар не найден или больше не продаётся",
    "out_of_stock": "Товара нет в наличии",
    "no_price": "У товара нет цены",
}


class CartLine(BaseModel):
    sku: int
    name: str
    slug: str
    vendor: str | None
    part: str | None
    image: ImageOut | None  # the main photo, when it is ready
    qty: int
    multiplicity: int
    stock: int
    in_stock: bool
    price: float | None  # unit price of the cart's price type
    prices: dict[PaymentMethod, float | None]  # unit price of this audience for each payment method
    total: float | None
    problem: Problem | None  # why the line cannot be ordered


class NotAdded(BaseModel):
    sku: int
    reason: Problem


class BuyerOut(BaseModel):
    """The organization a cart is priced for."""

    id: int
    name: str
    inn: str

    @classmethod
    def of(cls, org: Organization) -> "BuyerOut":
        return cls(id=org.id, name=org.name, inn=org.inn)


class CartOut(BaseModel):
    audience: Audience
    organization: BuyerOut | None  # the organization the cart is priced for; None: the user as a private person
    payment: PaymentMethod
    price_type: PriceType
    items: list[CartLine]
    lines: int
    units: int
    total: float  # the lines without a problem, at the prices of the chosen payment method
    totals: dict[PaymentMethod, float]  # the same for each payment method
    can_checkout: bool  # at least one line and none with a problem
    not_added: list[NotAdded] = []  # POST /items: the products that were not added


class ItemIn(BaseModel):
    sku: int = Field(ge=1, le=MAX_SKU)
    qty: int = Field(ge=1, le=MAX_QTY)


class AddIn(BaseModel):
    items: list[ItemIn] = Field(min_length=1, max_length=500)


class QtyIn(BaseModel):
    qty: int = Field(ge=0, le=MAX_QTY, description="0 removes the line")


class BuyerIn(BaseModel):
    organization_id: int | None = Field(None, ge=1, le=MAX_SKU, description="None: as a private person")


class PricesOut(BaseModel):
    audience: Audience
    prices: dict[int, dict[PaymentMethod, float | None]]  # sku -> unit price for each payment method


SkuPath = Annotated[int, Path(ge=1, le=MAX_SKU)]
Payment = Annotated[PaymentMethod, Query(description="The payment method whose prices the cart shows")]


# --- pricing the lines ----------------------------------------------------------------------


def problem(p: Product | None, price: Decimal | None) -> Problem | None:
    if p is None or not p.is_active or p.is_hidden:
        return "not_found"
    if not p.in_stock:
        return "out_of_stock"
    if price is None:
        return "no_price"
    return None


@dataclass
class Line:
    """A cart line priced for one audience (Decimal amounts: the checkout takes the order lines from it)."""

    item: CartItem
    product: Product | None  # None: no such product any more
    prices: dict[PaymentMethod, Decimal | None]  # None for both while the product is not sold

    def problem(self, payment: PaymentMethod) -> Problem | None:
        return problem(self.product, self.prices[payment])


async def load_products(session: AsyncSession, skus: set[int]) -> dict[int, Product]:
    if not skus:
        return {}
    stmt = select(Product).where(Product.sku.in_(skus)).options(selectinload(Product.main_image))
    return {p.sku: p for p in await session.scalars(stmt)}


async def priced_lines(session: AsyncSession, cart: Cart | None, audience: Audience) -> list[Line]:
    items = list(cart.items) if cart else []
    products = await load_products(session, {i.sku for i in items})
    lines = []
    for item in items:
        p = products.get(item.sku)
        sold = p is not None and p.is_active and not p.is_hidden
        prices = {m: p.price_for(price_type(audience, m)) if sold else None for m in PaymentMethod}
        lines.append(Line(item, p, prices))
    return lines


def _money(x: Decimal | None) -> float | None:
    return float(x) if x is not None else None


def cart_out(
    lines: list[Line], audience: Audience, payment: PaymentMethod, buyer: Organization | None, not_added: list[NotAdded] | None = None
) -> CartOut:
    items = []
    for line in lines:
        p, qty, price = line.product, line.item.qty, line.prices[payment]
        img = p.main_image if p is not None else None
        items.append(
            CartLine(
                sku=line.item.sku,
                name=p.name if p else f"Товар {line.item.sku}",
                slug=p.slug if p else "",
                vendor=p.vendor if p else None,
                part=p.part if p else None,
                image=ImageOut.of(img) if img is not None and img.status in VISIBLE_STATUSES else None,
                qty=qty,
                multiplicity=p.multiplicity if p else 1,
                stock=p.qty_central + p.qty_nearest if p else 0,
                in_stock=p.in_stock if p else False,
                price=_money(price),
                prices={m: _money(v) for m, v in line.prices.items()},
                total=_money(price * qty if price is not None else None),
                problem=line.problem(payment),
            )
        )
    totals = {
        m: sum((line.prices[m] * line.item.qty for line in lines if line.problem(m) is None), Decimal(0))
        for m in PaymentMethod
    }
    return CartOut(
        audience=audience,
        organization=BuyerOut.of(buyer) if buyer is not None else None,
        payment=payment,
        price_type=price_type(audience, payment),
        items=items,
        lines=len(lines),
        units=sum(line.item.qty for line in lines),
        total=float(totals[payment]),
        totals={m: float(v) for m, v in totals.items()},
        can_checkout=bool(lines) and all(line.problem(payment) is None for line in lines),
        not_added=not_added or [],
    )


def round_qty(qty: int, multiplicity: int) -> int:
    """Up to a whole number of packs (the product's multiplicity), at least one pack and at most MAX_QTY."""
    m = max(1, multiplicity)
    qty = max(m, -(-qty // m) * m)
    return qty if qty <= MAX_QTY else max(m, MAX_QTY // m * m)


# --- finding and changing the cart ----------------------------------------------------------


async def _find(session: AsyncSession, user_id: int) -> Cart | None:
    stmt = select(Cart).where(Cart.user_id == user_id)
    return await session.scalar(stmt.options(selectinload(Cart.items), selectinload(Cart.organization).selectinload(Organization.members)))


async def _new_cart(session: AsyncSession, user_id: int) -> Cart:
    # ON CONFLICT DO NOTHING: a parallel request of the same user (two quick clicks) may be creating it too
    if session.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    now = utcnow()
    stmt = insert(Cart.__table__).values(user_id=user_id, created_at=now, updated_at=now)
    await session.execute(stmt.on_conflict_do_nothing(index_elements=["user_id"]))
    return await _find(session, user_id)


async def approved_organizations(session: AsyncSession, user: User) -> list[Organization]:
    """The approved organizations the user is a member of, oldest membership first (`members` loaded)."""
    stmt = (
        select(Organization)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user.id, Organization.status == OrganizationStatus.approved)
        .order_by(OrganizationMember.created_at, Organization.id)
        .options(selectinload(Organization.members))
    )
    return list(await session.scalars(stmt))


@dataclass
class Buyer:
    """A user, their cart (None until the first change) and the organization it is priced for (None: the user
    buys as a private person)."""

    user: User
    cart: Cart | None
    organization: Organization | None

    @property
    def audience(self) -> Audience:
        return audience_of(self.organization)

    def price_type(self, payment: PaymentMethod) -> PriceType:
        return price_type(self.audience, payment)


async def find_buyer(session: AsyncSession, user: User) -> Buyer:
    """Whoever the user chose on the cart: themselves as a private person, or an organization while they may still
    buy for it. Else an organization wins: their first approved one, and the person only without any. Only the
    user's own choice is kept on the cart, so an organization chosen while it is checked (one just added) becomes
    the buyer once it is approved."""
    cart = await _find(session, user.id)
    if cart is not None and cart.as_person:
        return Buyer(user, cart, None)
    org = cart.organization if cart is not None else None
    if not can_buy_for(user, org):
        orgs = await approved_organizations(session, user)
        org = orgs[0] if orgs else None
    return Buyer(user, cart, org)


async def choose_buyer(session: AsyncSession, user_id: int, organization: Organization | None) -> Cart:
    """Keeps the user's choice of who they buy as on their cart (made if there is none yet). The caller commits."""
    cart = await _find(session, user_id) or await _new_cart(session, user_id)
    cart.organization = organization
    cart.as_person = organization is None
    return cart


async def _buyer(user: CurrentUser, session: Session) -> Buyer:
    return await find_buyer(session, user)


BuyerDep = Annotated[Buyer, Depends(_buyer)]


async def _writable(session: AsyncSession, b: Buyer) -> Cart:
    """The cart to change (created on the first change); bumps `updated_at`."""
    b.cart = b.cart or await _new_cart(session, b.user.id)
    b.cart.updated_at = utcnow()
    return b.cart


async def _respond(session: AsyncSession, response: Response, b: Buyer, payment: PaymentMethod, not_added: list[NotAdded] | None = None) -> CartOut:
    response.headers["Cache-Control"] = "no-store"
    return cart_out(await priced_lines(session, b.cart, b.audience), b.audience, payment, b.organization, not_added)


# --- endpoints ------------------------------------------------------------------------------


@router.get("", response_model=CartOut)
async def get_cart(response: Response, session: Session, buyer: BuyerDep, payment: Payment = PaymentMethod.cash):
    return await _respond(session, response, buyer, payment)


@router.post("/items", response_model=CartOut)
async def add_items(body: AddIn, response: Response, session: Session, buyer: BuyerDep, payment: Payment = PaymentMethod.cash):
    """Adds the quantities to the lines already in the cart. Products that cannot be ordered are not added:
    they are listed in `not_added`."""
    t = buyer.price_type(payment)
    wanted: dict[int, int] = {}
    for i in body.items:
        wanted[i.sku] = wanted.get(i.sku, 0) + i.qty
    products = await load_products(session, set(wanted))
    not_added = []
    for sku in list(wanted):
        p = products.get(sku)
        if reason := problem(p, p.price_for(t) if p else None):
            not_added.append(NotAdded(sku=sku, reason=reason))
            del wanted[sku]
    if wanted:
        lines = {i.sku: i for i in buyer.cart.items} if buyer.cart else {}
        if len(lines) + len(wanted.keys() - lines.keys()) > MAX_LINES:
            raise HTTPException(409, f"В корзине не больше {MAX_LINES} позиций")
        cart = await _writable(session, buyer)
        for sku, qty in wanted.items():
            multiplicity = products[sku].multiplicity
            if sku in lines:
                lines[sku].qty = round_qty(lines[sku].qty + qty, multiplicity)
            else:
                cart.items.append(CartItem(sku=sku, qty=round_qty(qty, multiplicity)))
        await session.commit()
    return await _respond(session, response, buyer, payment, not_added)


@router.put("/items/{sku}", response_model=CartOut)
async def set_qty(sku: SkuPath, body: QtyIn, response: Response, session: Session, buyer: BuyerDep, payment: Payment = PaymentMethod.cash):
    """Sets the quantity of a product (rounded up to its multiplicity); 0 removes the line."""
    line = next((i for i in buyer.cart.items if i.sku == sku), None) if buyer.cart else None
    if body.qty == 0:
        if line is not None:
            (await _writable(session, buyer)).items.remove(line)
            await session.commit()
        return await _respond(session, response, buyer, payment)
    p = (await load_products(session, {sku})).get(sku)
    if reason := problem(p, p.price_for(buyer.price_type(payment)) if p else None):
        raise HTTPException(422, PROBLEM_TEXT[reason])
    qty = round_qty(body.qty, p.multiplicity)
    if line is None and buyer.cart is not None and len(buyer.cart.items) >= MAX_LINES:
        raise HTTPException(409, f"В корзине не больше {MAX_LINES} позиций")
    cart = await _writable(session, buyer)
    if line is not None:
        line.qty = qty
    else:
        cart.items.append(CartItem(sku=sku, qty=qty))
    await session.commit()
    return await _respond(session, response, buyer, payment)


@router.delete("/items/{sku}", response_model=CartOut)
async def remove_item(sku: SkuPath, response: Response, session: Session, buyer: BuyerDep, payment: Payment = PaymentMethod.cash):
    line = next((i for i in buyer.cart.items if i.sku == sku), None) if buyer.cart else None
    if line is not None:
        (await _writable(session, buyer)).items.remove(line)
        await session.commit()
    return await _respond(session, response, buyer, payment)


@router.delete("", response_model=CartOut)
async def clear_cart(response: Response, session: Session, buyer: BuyerDep, payment: Payment = PaymentMethod.cash):
    """Removes every line (the cart itself stays)."""
    if buyer.cart is not None and buyer.cart.items:
        (await _writable(session, buyer)).items.clear()
        await session.commit()
    return await _respond(session, response, buyer, payment)


@router.put("/organization", response_model=CartOut)
async def set_organization(body: BuyerIn, response: Response, session: Session, user: CurrentUser, payment: Payment = PaymentMethod.cash):
    """Who the cart is priced for (the switch in the site header): one of the user's approved organizations, or
    the user as a private person (`organization_id` null)."""
    org = None
    if body.organization_id is not None:
        org = await session.scalar(select(Organization).where(Organization.id == body.organization_id).options(selectinload(Organization.members)))
        if org is None or org.role_of(user.id) is None:
            raise HTTPException(404, "Организация не найдена")
        if not can_buy_for(user, org):
            raise HTTPException(409, "Организация ещё не подтверждена: её цены станут доступны после проверки")
    cart = await choose_buyer(session, user.id, org)
    cart.updated_at = utcnow()
    await session.commit()
    return await _respond(session, response, Buyer(user, cart, org), payment)


MAX_PRICE_SKUS = 200


@router.get("/prices", response_model=PricesOut)
async def buyer_prices(
    response: Response,
    session: Session,
    buyer: BuyerDep,
    sku: Annotated[list[int], Query(max_length=MAX_PRICE_SKUS, description="Products of the page being viewed")] = [],
):
    """Prices of the given products for whoever the cart is priced for: catalog pages are the same for everyone (and
    show no prices), a client's browser takes them from here. Products not sold are left out."""
    products = await load_products(session, {s for s in sku if 1 <= s <= MAX_SKU})
    response.headers["Cache-Control"] = "no-store"
    return PricesOut(
        audience=buyer.audience,
        prices={
            p.sku: {m: _money(p.price_for(buyer.price_type(m))) for m in PaymentMethod}
            for p in products.values()
            if p.is_active and not p.is_hidden
        },
    )
