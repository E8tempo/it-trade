from datetime import date
from decimal import ROUND_CEILING, Decimal
from enum import StrEnum

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.catalog import Money, PaymentMethod
from app.models.organizations import Organization

Percent = Numeric(7, 2)
CENT = Decimal("0.01")


class PriceSource(StrEnum):
    """Where a line's selling price comes from (QuoteItem.sale_price)."""

    fixed = "fixed"  # typed in by the client
    rrp = "rrp"  # the supplier's recommended retail price
    markup = "markup"  # the client's markup over what they pay us


class Quote(TimestampMixin, Base):
    """A commercial offer (КП) a client makes for their own customer: our products at the client's prices, with the
    client's requisites. Nothing of ours is printed on it. The lines keep what the client pays us for each product
    (`cost`) at the time it was added or the prices were refreshed: the offer does not change by itself."""

    __tablename__ = "quotes"
    __table_args__ = (UniqueConstraint("organization_id", "number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # the client's organization: the seller on the offer, its wholesale prices are the costs
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)  # the author
    number: Mapped[int]  # 1, 2, ... within the organization
    title: Mapped[str | None] = mapped_column(String(255))  # what it is for: «Оснащение офиса»
    customer: Mapped[str | None] = mapped_column(String(255))  # to whom: the client's customer
    customer_contact: Mapped[str | None] = mapped_column(String(255))  # their contact person, phone
    # whose wholesale prices are the costs: what the client is going to pay us with
    payment: Mapped[PaymentMethod] = mapped_column(String(16), default=PaymentMethod.cashless)
    markup_percent: Mapped[Decimal] = mapped_column(Percent, default=Decimal(20))  # over the costs, lines may differ
    use_rrp: Mapped[bool] = mapped_column(default=False)  # sell at the supplier's RRP where there is one
    round_to: Mapped[int] = mapped_column(default=1)  # selling prices up to whole roubles, tens or hundreds
    vat_rate: Mapped[int | None]  # the prices include VAT at this rate; None: «Без НДС»
    valid_until: Mapped[date | None]
    terms: Mapped[str | None] = mapped_column(Text)  # payment, delivery, warranty: printed under the lines
    show_photos: Mapped[bool] = mapped_column(default=True)

    organization: Mapped[Organization] = relationship()
    items: Mapped[list["QuoteItem"]] = relationship(
        back_populates="quote", cascade="all, delete-orphan", order_by="[QuoteItem.position, QuoteItem.id]"
    )


class QuoteItem(Base):
    """A line of an offer: a product of the catalog, or the client's own (installation, delivery) without a sku."""

    __tablename__ = "quote_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("quotes.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(default=0)
    # no foreign key, like order_items: the offer survives the product leaving the catalog
    sku: Mapped[int | None]
    name: Mapped[str] = mapped_column(String(1024))  # the product's name, the client may change it
    vendor: Mapped[str | None] = mapped_column(String(255))
    part: Mapped[str | None] = mapped_column(String(255))  # the maker's part number: printed, unlike our sku
    unit: Mapped[str] = mapped_column(String(16), default="шт.")
    qty: Mapped[int] = mapped_column(default=1)
    cost: Mapped[Decimal | None] = mapped_column(Money)  # what the client pays us per unit; None: no price / own line
    rrp: Mapped[Decimal | None] = mapped_column(Money)  # the supplier's RRP per unit, when it has one
    markup_percent: Mapped[Decimal | None] = mapped_column(Percent)  # None: the offer's
    price: Mapped[Decimal | None] = mapped_column(Money)  # a selling price typed in, wins over the rest

    quote: Mapped[Quote] = relationship(back_populates="items")

    def sale(self) -> tuple[Decimal | None, PriceSource | None]:
        """The selling price per unit and where it comes from; None while it is unknown (no cost and none typed in)."""
        if self.price is not None:
            return self.price, PriceSource.fixed
        q = self.quote
        if q.use_rrp and self.rrp is not None:
            return self.rrp, PriceSource.rrp
        if self.cost is None:
            return None, None
        pct = self.markup_percent if self.markup_percent is not None else q.markup_percent
        return round_up(self.cost * (1 + pct / 100), q.round_to), PriceSource.markup


def round_up(price: Decimal, step: int) -> Decimal:
    """Up to the step in roubles (to the kopeck for 0), never below the price itself."""
    if step <= 0:
        return price.quantize(CENT, rounding=ROUND_CEILING)
    s = Decimal(step)
    return ((price / s).to_integral_value(rounding=ROUND_CEILING) * s).quantize(CENT)


def vat_included(total: Decimal, rate: int | None) -> Decimal | None:
    """The VAT inside a total that includes it."""
    return None if rate is None else (total * rate / (100 + rate)).quantize(CENT)
