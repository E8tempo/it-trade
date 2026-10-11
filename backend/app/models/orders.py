from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, utcnow
from app.models.catalog import Money


class OrderStatus(StrEnum):
    new = "new"  # just placed, nobody has looked at it yet
    confirmed = "confirmed"  # the manager called the customer back and agreed the details
    ordered = "ordered"  # ordered from the supplier
    ready = "ready"  # arrived, waiting for pickup or delivery
    shipped = "shipped"  # handed over to the courier / transport company
    completed = "completed"  # received and paid
    cancelled = "cancelled"


# statuses after which an order can no longer change
FINAL_STATUSES = (OrderStatus.completed, OrderStatus.cancelled)


class OrderSource(StrEnum):
    site = "site"  # checkout on the website
    phone = "phone"  # taken by a manager over the phone / messenger
    admin = "admin"  # entered in the admin panel for another reason


class DeliveryMethod(StrEnum):
    pickup = "pickup"
    courier = "courier"  # delivery by our courier within the city
    transport = "transport"  # transport company to another city of Crimea


class Order(TimestampMixin, Base):
    """Customer order. Amounts are snapshots taken when the order or its items change."""

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[OrderStatus] = mapped_column(String(16), default=OrderStatus.new, index=True)
    source: Mapped[OrderSource] = mapped_column(String(16), default=OrderSource.site)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)

    customer_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(32), index=True)
    email: Mapped[str | None] = mapped_column(String(254))
    delivery: Mapped[DeliveryMethod] = mapped_column(String(16), default=DeliveryMethod.pickup)
    city: Mapped[str | None] = mapped_column(String(128))
    address: Mapped[str | None] = mapped_column(String(512))
    comment: Mapped[str | None] = mapped_column(Text)  # from the customer
    manager_note: Mapped[str | None] = mapped_column(Text)  # internal

    items_total: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    delivery_price: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    discount: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    total: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    cost_total: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))  # supplier prices of the items

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.id"
    )
    events: Mapped[list["OrderEvent"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderEvent.id"
    )

    def recalc(self) -> None:
        self.items_total = sum((i.price * i.qty for i in self.items), Decimal(0))
        self.cost_total = sum(((i.supplier_price or i.price) * i.qty for i in self.items), Decimal(0))
        self.total = max(Decimal(0), self.items_total + self.delivery_price - self.discount)


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    # no foreign key: the order must survive the product disappearing from the supplier catalog
    sku: Mapped[int] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(1024))
    price: Mapped[Decimal] = mapped_column(Money)  # retail price per unit
    supplier_price: Mapped[Decimal | None] = mapped_column(Money)  # cost per unit, for the margin
    qty: Mapped[int] = mapped_column(default=1)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderEvent(Base):
    """Order history: status changes and notes, with who made them."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(default=utcnow)
    status: Mapped[OrderStatus | None] = mapped_column(String(16))  # set when the status changed
    note: Mapped[str | None] = mapped_column(Text)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    author: Mapped[str | None] = mapped_column(String(255))  # name or e-mail at the time

    order: Mapped[Order] = relationship(back_populates="events")
