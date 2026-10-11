"""Orders: list, details, manual creation (phone orders) and processing."""

import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.admin.common import Money, Admin, Page, Session, like
from app.models import DeliveryMethod, Order, OrderEvent, OrderItem, OrderSource, OrderStatus, Product
from app.models.orders import FINAL_STATUSES

router = APIRouter()


class OrderItemIn(BaseModel):
    sku: int
    qty: int = Field(1, ge=1, le=999)
    price: Decimal | None = Field(None, ge=0, description="Unit price; the current shop price if omitted")


class OrderIn(BaseModel):
    customer_name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=5, max_length=32)
    email: EmailStr | None = None
    delivery: DeliveryMethod = DeliveryMethod.pickup
    city: str | None = Field(None, max_length=128)
    address: str | None = Field(None, max_length=512)
    comment: str | None = None
    manager_note: str | None = None
    delivery_price: Decimal = Field(Decimal(0), ge=0)
    discount: Decimal = Field(Decimal(0), ge=0)
    source: OrderSource = OrderSource.phone
    items: list[OrderItemIn] = Field(min_length=1)


class OrderPatch(BaseModel):
    """Only the fields that are sent are changed. `note` is added to the history."""

    status: OrderStatus | None = None
    note: str | None = None
    customer_name: str | None = Field(None, min_length=1, max_length=255)
    phone: str | None = Field(None, min_length=5, max_length=32)
    email: EmailStr | None = None
    delivery: DeliveryMethod | None = None
    city: str | None = Field(None, max_length=128)
    address: str | None = Field(None, max_length=512)
    comment: str | None = None
    manager_note: str | None = None
    delivery_price: Decimal | None = Field(None, ge=0)
    discount: Decimal | None = Field(None, ge=0)
    items: list[OrderItemIn] | None = Field(None, min_length=1)


class OrderItemOut(BaseModel):
    id: int
    sku: int
    name: str
    price: Money
    supplier_price: Money | None
    qty: int
    total: Money
    slug: str | None  # product page, if the product still exists


class OrderEventOut(BaseModel):
    id: int
    at: datetime
    status: OrderStatus | None
    note: str | None
    author: str | None


class OrderListItem(BaseModel):
    id: int
    number: str
    status: OrderStatus
    source: OrderSource
    customer_name: str
    phone: str
    total: Money
    items_count: int
    created_at: datetime


class OrderOut(OrderListItem):
    email: str | None
    delivery: DeliveryMethod
    city: str | None
    address: str | None
    comment: str | None
    manager_note: str | None
    items_total: Money
    delivery_price: Money
    discount: Money
    cost_total: Money
    margin: Money  # items after the discount minus their supplier cost
    updated_at: datetime
    items: list[OrderItemOut]
    events: list[OrderEventOut]


class OrderPage(Page[OrderListItem]):
    counts: dict[str, int]  # orders per status, for the filter tabs


def number(order_id: int) -> str:
    return f"{order_id:06d}"


def list_item(o: Order) -> OrderListItem:
    return OrderListItem(
        id=o.id,
        number=number(o.id),
        status=o.status,
        source=o.source,
        customer_name=o.customer_name,
        phone=o.phone,
        total=o.total,
        items_count=sum(i.qty for i in o.items),
        created_at=o.created_at,
    )


async def _out(session: Session, o: Order) -> OrderOut:
    skus = {i.sku for i in o.items}
    slugs = dict((await session.execute(select(Product.sku, Product.slug).where(Product.sku.in_(skus)))).all()) if skus else {}
    return OrderOut(
        **list_item(o).model_dump(),
        email=o.email,
        delivery=o.delivery,
        city=o.city,
        address=o.address,
        comment=o.comment,
        manager_note=o.manager_note,
        items_total=o.items_total,
        delivery_price=o.delivery_price,
        discount=o.discount,
        cost_total=o.cost_total,
        margin=o.items_total - o.discount - o.cost_total,
        updated_at=o.updated_at,
        items=[
            OrderItemOut(
                id=i.id,
                sku=i.sku,
                name=i.name,
                price=i.price,
                supplier_price=i.supplier_price,
                qty=i.qty,
                total=i.price * i.qty,
                slug=slugs.get(i.sku),
            )
            for i in o.items
        ],
        events=[OrderEventOut(id=e.id, at=e.at, status=e.status, note=e.note, author=e.author) for e in o.events],
    )


async def _load(session: Session, order_id: int) -> Order:
    o = await session.scalar(
        select(Order).where(Order.id == order_id).options(selectinload(Order.items), selectinload(Order.events))
    )
    if o is None:
        raise HTTPException(404, "Order not found")
    return o


async def _items(session: Session, items: list[OrderItemIn]) -> list[OrderItem]:
    """Order lines with the product name and prices as of now."""
    products = {
        p.sku: p for p in await session.scalars(select(Product).where(Product.sku.in_({i.sku for i in items})))
    }
    out = []
    for i in items:
        p = products.get(i.sku)
        if p is None:
            raise HTTPException(422, f"Товар {i.sku} не найден")
        price = i.price if i.price is not None else p.price
        if price is None:
            raise HTTPException(422, f"У товара {i.sku} нет цены, укажите её вручную")
        out.append(OrderItem(sku=p.sku, name=p.name, price=price, supplier_price=p.supplier_price, qty=i.qty))
    return out


def _author(admin) -> str:
    return admin.name or admin.email


@router.get("/orders", response_model=OrderPage)
async def list_orders(
    session: Session,
    status: OrderStatus | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 30,
):
    stmt = select(Order)
    if status:
        stmt = stmt.where(Order.status == status)
    if q and q.strip():
        conds = [func.lower(Order.customer_name).like(like(q), escape="\\"), Order.email.ilike(like(q), escape="\\")]
        digits = re.sub(r"\D", "", q)
        if digits:
            conds.append(Order.phone.like(f"%{digits[-10:]}%"))
            conds.append(Order.id == int(digits))
        stmt = stmt.where(or_(*conds))
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(
        stmt.options(selectinload(Order.items)).order_by(Order.id.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    counts = dict((await session.execute(select(Order.status, func.count()).group_by(Order.status))).all())
    return OrderPage(items=[list_item(o) for o in rows], total=total, page=page, per_page=per_page, counts=counts)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: int, session: Session):
    return await _out(session, await _load(session, order_id))


@router.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(body: OrderIn, session: Session, admin: Admin):
    data = body.model_dump(exclude={"items"})
    data["phone"] = _phone(body.phone)
    o = Order(**data, items=await _items(session, body.items))
    o.recalc()
    o.events.append(OrderEvent(status=OrderStatus.new, note="Заказ создан в админке", author_id=admin.id, author=_author(admin)))
    session.add(o)
    await session.commit()
    return await _out(session, await _load(session, o.id))


@router.patch("/orders/{order_id}", response_model=OrderOut)
async def update_order(order_id: int, body: OrderPatch, session: Session, admin: Admin):
    o = await _load(session, order_id)
    fields = body.model_dump(exclude_unset=True, exclude={"status", "note", "items"})
    if body.items is not None or {"delivery_price", "discount"} & fields.keys():
        if o.status in FINAL_STATUSES:
            raise HTTPException(409, "Завершённый или отменённый заказ нельзя изменить")
    if "phone" in fields:
        fields["phone"] = _phone(fields["phone"])
    for k, v in fields.items():
        setattr(o, k, v)
    changes = []
    if body.items is not None:
        o.items = await _items(session, body.items)
        changes.append("состав заказа изменён")
    o.recalc()
    status_changed = body.status is not None and body.status != o.status
    if status_changed:
        o.status = body.status
    note = "; ".join(filter(None, [body.note and body.note.strip(), *changes])) or None
    if status_changed or note:
        o.events.append(
            OrderEvent(status=body.status if status_changed else None, note=note, author_id=admin.id, author=_author(admin))
        )
    await session.commit()
    session.expunge_all()
    return await _out(session, await _load(session, order_id))


def _phone(phone: str) -> str:
    """Keep the leading + and digits: "+7 (978) 000-00-00" -> "+79780000000"."""
    p = phone.strip()
    return ("+" if p.startswith("+") else "") + re.sub(r"\D", "", p)
