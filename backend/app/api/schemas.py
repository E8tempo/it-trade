from datetime import date

from pydantic import BaseModel

from app.config import get_settings
from app.images.processing import SIZES, image_url
from app.models import Category, ContractTerms, Product, ProductImage


class ImageOut(BaseModel):
    id: int
    width: int | None = None
    height: int | None = None
    urls: dict[str, str]  # size name -> url, see SIZES

    @classmethod
    def of(cls, img: ProductImage) -> "ImageOut":
        media = get_settings().media_url
        return cls(
            id=img.id,
            width=img.width,
            height=img.height,
            urls={s: image_url(media, img.id, s, img.version) for s in SIZES},
        )


class CategoryRef(BaseModel):
    id: int
    name: str
    slug: str


class CategoryNode(CategoryRef):
    product_count: int
    children: list["CategoryNode"] = []


class CategoryDetail(CategoryRef):
    product_count: int
    breadcrumbs: list[CategoryRef]
    children: list[CategoryNode]

    @staticmethod
    def ref(c: Category) -> CategoryRef:
        return CategoryRef(id=c.id, name=c.name, slug=c.slug)


class ProductCard(BaseModel):
    sku: int
    name: str
    slug: str
    vendor: str | None
    part: str | None
    # no prices: the site sells to businesses only, a client's browser takes them from /api/cart/prices
    in_stock: bool
    qty: int
    image: ImageOut | None

    @classmethod
    def of(cls, p: Product, image: ProductImage | None) -> "ProductCard":
        return cls(
            sku=p.sku,
            name=p.name,
            slug=p.slug,
            vendor=p.vendor,
            part=p.part,
            in_stock=p.in_stock,
            qty=p.qty_central + p.qty_nearest,
            image=ImageOut.of(image) if image else None,
        )


class VendorFacet(BaseModel):
    name: str
    count: int


class ProductPage(BaseModel):
    items: list[ProductCard]
    total: int
    page: int
    per_page: int
    vendors: list[VendorFacet]


class ProductDetail(ProductCard):
    description: str | None
    barcodes: list[str]
    weight: float | None
    volume: float | None
    warranty_months: int | None
    multiplicity: int
    delivery_days: int | None
    category: CategoryRef | None
    breadcrumbs: list[CategoryRef]
    images: list[ImageOut]


class ContractRef(BaseModel):
    id: int
    number: str
    signed_on: date
    terms: ContractTerms
    deferral_days: int | None


class OrderBuyer(BaseModel):
    """The organization an order was placed for and its contract, as they were at checkout (Order.buyer)."""

    name: str
    inn: str
    kpp: str | None
    ogrn: str | None
    address: str | None
    contract: ContractRef | None
