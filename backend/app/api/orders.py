"""Checkout and the client's orders.

The order is made of the cart's lines at the server's prices for the chosen payment method: the wholesale prices of
the cart's organization, or the retail ones when the user buys as a private person. An organization's order keeps
its requisites and the chosen contract as they are at checkout. An organization's owner sees all its orders, a
purchaser their own. Clients never see supplier prices, margins, manager notes or the notes and authors of the
history: only the status changes.
"""

import time
from collections import defaultdict, deque
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.admin.common import Page
from app.api.admin.orders import number
from app.api.cart import find_buyer, load_products, priced_lines
from app.api.deps import CurrentUser, Session, client_ip
from app.api.schemas import ImageOut, OrderBuyer
from app.auth import normalize_email
from app.models import (
    CartItem,
    Contract,
    DeliveryMethod,
    MemberRole,
    Order,
    OrderEvent,
    OrderItem,
    OrderSource,
    OrderStatus,
    OrganizationMember,
    PaymentMethod,
    User,
)
from app.models.base import utcnow
from app.models.catalog import VISIBLE_STATUSES
from app.models.orders import FINAL_STATUSES, normalize_phone
from app.models.organizations import buyer_snapshot

router = APIRouter(prefix="/api/orders", tags=["orders"])

CENT = Decimal("0.01")
MAX_ID = 2**31 - 1


class CheckoutIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    customer_name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=5, max_length=32)
    email: EmailStr | None = None
    delivery: DeliveryMethod
    city: str | None = Field(None, max_length=128)
    address: str | None = Field(None, max_length=512)
    comment: str | None = Field(None, max_length=2000)
    payment_method: PaymentMethod
    # one of the active contracts of the cart's organization, or None for the manager to settle (always None for a
    # private person)
    contract_id: int | None = Field(None, ge=1, le=MAX_ID)
    # the total the customer saw: if the prices have changed since, the order is not placed
    expected_total: Decimal | None = Field(None, ge=0, lt=10**10)

    @field_validator("email", "city", "address", "comment", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v


class CustomerOrderItem(BaseModel):
    sku: int
    name: str
    slug: str | None  # product page, while the product is sold
    image: ImageOut | None
    price: float
    qty: int
    total: float


class StatusChange(BaseModel):
    at: datetime
    status: OrderStatus


class CustomerOrderListItem(BaseModel):
    id: int
    number: str
    status: OrderStatus
    created_at: datetime
    total: float
    items_count: int
    payment_method: PaymentMethod
    buyer_name: str | None  # the organization it was bought for; None: as a private person


class CustomerOrderOut(BaseModel):
    id: int
    number: str
    status: OrderStatus
    created_at: datetime
    customer_name: str
    phone: str
    email: str | None
    delivery: DeliveryMethod
    city: str | None
    address: str | None
    comment: str | None
    payment_method: PaymentMethod
    buyer: OrderBuyer | None  # the organization it was bought for; None: as a private person
    items_total: float
    delivery_price: float
    discount: float
    total: float
    items: list[CustomerOrderItem]
    history: list[StatusChange]  # status changes only


# --- flood protection (per API process) ------------------------------------------------------

MAX_ORDERS, WINDOW = 10, 60 * 60  # orders per IP
_placed: defaultdict[str, deque[float]] = defaultdict(deque)


def _check_throttle(ip: str) -> None:
    now = time.monotonic()
    q = _placed[ip]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if not q:
        del _placed[ip]
    elif len(q) >= MAX_ORDERS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много заказов, попробуйте позже")


# --- helpers --------------------------------------------------------------------------------


async def _out(session: AsyncSession, o: Order) -> CustomerOrderOut:
    products = await load_products(session, {i.sku for i in o.items})
    items = []
    for i in o.items:
        p = products.get(i.sku)
        img = p.main_image if p is not None else None
        items.append(
            CustomerOrderItem(
                sku=i.sku,
                name=i.name,
                slug=p.slug if p is not None and p.is_active and not p.is_hidden else None,
                image=ImageOut.of(img) if img is not None and img.status in VISIBLE_STATUSES else None,
                price=float(i.price),
                qty=i.qty,
                total=float(i.price * i.qty),
            )
        )
    return CustomerOrderOut(
        id=o.id,
        number=number(o.id),
        status=o.status,
        created_at=o.created_at,
        customer_name=o.customer_name,
        phone=o.phone,
        email=o.email,
        delivery=o.delivery,
        city=o.city,
        address=o.address,
        comment=o.comment,
        payment_method=o.payment_method,
        buyer=OrderBuyer.model_validate(o.buyer) if o.buyer else None,
        items_total=float(o.items_total),
        delivery_price=float(o.delivery_price),
        discount=float(o.discount),
        total=float(o.total),
        items=items,
        history=[StatusChange(at=e.at, status=e.status) for e in o.events if e.status is not None],
    )


# --- endpoints ------------------------------------------------------------------------------


@router.post("", response_model=CustomerOrderOut, status_code=status.HTTP_201_CREATED)
async def place_order(body: CheckoutIn, request: Request, response: Response, session: Session, user: CurrentUser):
    """Places the order of the cart for its organization (or the user as a private person) and empties the cart. 409
    when the cart is empty, has lines that cannot be ordered or its total is no longer `expected_total`: the client
    reads the cart again."""
    ip = client_ip(request)
    _check_throttle(ip)
    if body.delivery == DeliveryMethod.transport and not body.city:
        raise HTTPException(422, "Укажите город доставки")
    if body.delivery != DeliveryMethod.pickup and not body.address:
        raise HTTPException(422, "Укажите адрес доставки")
    phone = normalize_phone(body.phone)
    if len(phone.lstrip("+")) < 5:
        raise HTTPException(422, "Проверьте номер телефона")

    payment = body.payment_method
    b = await find_buyer(session, user)
    cart, org = b.cart, b.organization
    contract = None
    if body.contract_id is not None:
        contract = await session.get(Contract, body.contract_id)
        if org is None or contract is None or contract.organization_id != org.id or not contract.is_active:
            raise HTTPException(409, "Договор недоступен. Выберите другой или оформите заказ без договора.")
    lines = await priced_lines(session, cart, b.audience)
    if not lines:
        raise HTTPException(409, "Корзина пуста")
    if any(line.problem(payment) for line in lines):
        raise HTTPException(409, "Некоторых товаров уже нет в наличии или у них нет цены. Проверьте корзину.")
    items = [
        OrderItem(sku=p.sku, name=p.name, price=line.prices[payment], supplier_price=p.supplier_price, qty=line.item.qty)
        for line in lines
        if (p := line.product) is not None
    ]
    total = sum((i.price * i.qty for i in items), Decimal(0))
    if body.expected_total is not None and body.expected_total.quantize(CENT) != total.quantize(CENT):
        raise HTTPException(409, "Цены изменились. Проверьте корзину.")

    # the lines are taken first: a second submit of the same cart (a double click) finds nothing to take
    taken = await session.execute(
        delete(CartItem).where(CartItem.cart_id == cart.id), execution_options={"synchronize_session": False}
    )
    if taken.rowcount != len(lines):
        await session.rollback()
        raise HTTPException(409, "Корзина изменилась. Проверьте корзину.")
    cart.updated_at = utcnow()

    o = Order(
        source=OrderSource.site,
        status=OrderStatus.new,
        user_id=user.id,
        customer_name=body.customer_name,
        phone=phone,
        email=normalize_email(body.email) if body.email else None,
        delivery=body.delivery,
        city=body.city if body.delivery != DeliveryMethod.pickup else None,
        address=body.address if body.delivery != DeliveryMethod.pickup else None,
        comment=body.comment,
        payment_method=payment,
        price_type=b.price_type(payment),
        organization_id=org.id if org else None,
        contract_id=contract.id if contract else None,
        buyer=buyer_snapshot(org, contract) if org else None,
        delivery_price=Decimal(0),
        discount=Decimal(0),
        items=items,
    )
    o.recalc()
    author = (body.customer_name or body.email or phone)[:255]
    o.events.append(OrderEvent(status=OrderStatus.new, note="Заказ оформлен на сайте", author_id=user.id, author=author))
    # remembered for the next checkout
    if not user.name and not user.last_name:
        user.name = body.customer_name
    if not user.phone:
        user.phone = body.phone
    session.add(o)
    await session.commit()
    _placed[ip].append(time.monotonic())
    response.headers["Cache-Control"] = "no-store"
    return await _out(session, o)


def _visible(user: User):
    """Orders a user sees: their own, and every order of the organizations they head."""
    headed = select(OrganizationMember.organization_id).where(OrganizationMember.user_id == user.id, OrganizationMember.role == MemberRole.owner)
    return or_(Order.user_id == user.id, Order.organization_id.in_(headed))


# the account's tabs: orders in progress, the completed and the cancelled ones
OrderState = Literal["open", "completed", "cancelled"]


class CustomerOrderPage(Page[CustomerOrderListItem]):
    counts: dict[OrderState, int]  # all the orders the user sees, per state


@router.get("", response_model=CustomerOrderPage)
async def my_orders(
    user: CurrentUser,
    session: Session,
    response: Response,
    state: OrderState | None = None,
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
    per_page: Annotated[int, Query(ge=1, le=50)] = 20,
):
    """The orders the user sees, newest first; `state` narrows them to one tab."""
    visible = _visible(user)
    by_status = dict((await session.execute(select(Order.status, func.count()).where(visible).group_by(Order.status))).all())
    counts: dict[OrderState, int] = {"open": 0, "completed": 0, "cancelled": 0}
    for st, n in by_status.items():
        counts["open" if st not in FINAL_STATUSES else OrderStatus(st).value] += n
    stmt = select(Order).where(visible)
    if state == "open":
        stmt = stmt.where(Order.status.not_in(FINAL_STATUSES))
    elif state:
        stmt = stmt.where(Order.status == state)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(
        stmt.options(selectinload(Order.items)).order_by(Order.id.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    response.headers["Cache-Control"] = "no-store"
    items = [
        CustomerOrderListItem(
            id=o.id,
            number=number(o.id),
            status=o.status,
            created_at=o.created_at,
            total=float(o.total),
            items_count=sum(i.qty for i in o.items),
            payment_method=o.payment_method,
            buyer_name=o.buyer["name"] if o.buyer else None,
        )
        for o in rows
    ]
    return CustomerOrderPage(items=items, total=total, page=page, per_page=per_page, counts=counts)


@router.get("/{order_id}", response_model=CustomerOrderOut)
async def my_order(order_id: Annotated[int, Path(ge=1, le=MAX_ID)], user: CurrentUser, session: Session, response: Response):
    o = await session.scalar(
        select(Order)
        .where(Order.id == order_id, _visible(user))
        .options(selectinload(Order.items), selectinload(Order.events))
    )
    if o is None:
        raise HTTPException(404, "Заказ не найден")
    response.headers["Cache-Control"] = "no-store"
    return await _out(session, o)
