from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

Money = Numeric(12, 2)


class Category(TimestampMixin, Base):
    """Supplier category tree. `id` is the supplier's category id."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255))
    depth: Mapped[int] = mapped_column(default=0)
    position: Mapped[int] = mapped_column(default=0)
    leaf: Mapped[bool] = mapped_column(default=True)
    # Materialized path of ids, e.g. "/9629/9756/91/" -> descendants via LIKE '/9629/%'
    path: Mapped[str] = mapped_column(String(512), index=True)
    # Number of in-stock products in this category and all descendants (recomputed after stock sync)
    product_count: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)  # present in the latest supplier tree
    is_hidden: Mapped[bool] = mapped_column(default=False)  # hidden by admin

    parent: Mapped["Category | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["Category"]] = relationship(back_populates="parent", order_by="Category.position")


class Product(TimestampMixin, Base):
    """Supplier product. `sku` is the supplier article number."""

    __tablename__ = "products"

    sku: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(1024))
    slug: Mapped[str] = mapped_column(String(255))
    part: Mapped[str | None] = mapped_column(String(255), index=True)
    vendor: Mapped[str | None] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    barcodes: Mapped[str | None] = mapped_column(String(1024))
    weight: Mapped[float | None]
    volume: Mapped[float | None]
    warranty_months: Mapped[int | None]
    rrp: Mapped[Decimal | None] = mapped_column(Money)
    multiplicity: Mapped[int] = mapped_column(default=1)
    has_image: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)  # present in the latest supplier catalog
    catalog_seen_at: Mapped[datetime | None]  # start of the last catalog sync that contained it
    # Lower-cased "name part vendor sku" used for substring search (pg_trgm index on Postgres)
    search_text: Mapped[str] = mapped_column(Text, default="")

    # Stock & price (from get_active_products)
    supplier_price: Mapped[Decimal | None] = mapped_column(Money)
    price: Mapped[Decimal | None] = mapped_column(Money)  # retail price after markup rules
    qty_central: Mapped[int] = mapped_column(default=0)
    qty_nearest: Mapped[int] = mapped_column(default=0)
    delivery_days: Mapped[int | None]
    in_stock: Mapped[bool] = mapped_column(default=False)
    is_marked: Mapped[bool] = mapped_column(default=False)  # subject to "Chestny Znak" labelling
    stock_updated_at: Mapped[datetime | None]

    # Images
    images_synced_at: Mapped[datetime | None]  # when the image list was last fetched from the supplier
    main_image_id: Mapped[int | None] = mapped_column(ForeignKey("product_images.id", ondelete="SET NULL", use_alter=True))

    category: Mapped[Category | None] = relationship()
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product",
        order_by="ProductImage.position",
        foreign_keys="ProductImage.sku",
        cascade="all, delete-orphan",
    )
    main_image: Mapped["ProductImage | None"] = relationship(foreign_keys=[main_image_id], post_update=True)

    __table_args__ = (
        Index("ix_products_listing", "category_id", "in_stock", "price"),
        Index("ix_products_in_stock_sku", "in_stock", "sku"),
    )


class ImageStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    failed = "failed"


class ProductImage(Base):
    """Supplier product image. `id` is the supplier's image record id.

    Processed files live in MEDIA_ROOT/products/<id % 1000>/<id>_<size>.webp
    """

    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    sku: Mapped[int] = mapped_column(ForeignKey("products.sku", ondelete="CASCADE"), index=True)
    source_url: Mapped[str] = mapped_column(String(512))
    position: Mapped[int] = mapped_column(default=0)
    priority: Mapped[int] = mapped_column(default=0)
    version: Mapped[int] = mapped_column(default=1)  # bumped when source_url changes (cache busting)

    status: Mapped[ImageStatus] = mapped_column(String(16), default=ImageStatus.pending)
    attempts: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(String(512))
    width: Mapped[int | None]
    height: Mapped[int | None]
    wm_template: Mapped[str | None] = mapped_column(String(32))  # which watermark variant was removed
    wm_score: Mapped[float | None]  # detection confidence
    processed_at: Mapped[datetime | None]

    product: Mapped[Product] = relationship(back_populates="images", foreign_keys=[sku])

    __table_args__ = (Index("ix_product_images_queue", "status", "position", "id"),)
