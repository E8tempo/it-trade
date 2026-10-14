from datetime import datetime

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, utcnow
from app.models.organizations import Organization


class Cart(TimestampMixin, Base):
    """The cart of a client's user. Prices are those of the organization the user works for now (chosen in the
    site header), kept here; `updated_at` is bumped on every change of the lines."""

    __tablename__ = "carts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"))

    organization: Mapped["Organization | None"] = relationship()
    items: Mapped[list["CartItem"]] = relationship(
        back_populates="cart", cascade="all, delete-orphan", order_by="[CartItem.added_at, CartItem.sku]"
    )


class CartItem(Base):
    __tablename__ = "cart_items"

    cart_id: Mapped[int] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"), primary_key=True)
    # no foreign key, like order_items: the line survives the product leaving the catalog
    sku: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    qty: Mapped[int]
    added_at: Mapped[datetime] = mapped_column(default=utcnow)

    cart: Mapped[Cart] = relationship(back_populates="items")
