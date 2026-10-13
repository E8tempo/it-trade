"""Algorithm lab: run the watermark removal on any photo and see every step."""

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import BigInteger, cast, func, or_, select
from starlette.concurrency import run_in_threadpool

from app.api.admin.common import Session, like
from app.api.media import ondemand_client
from app.config import get_settings
from app.images.lab import analyze
from app.images.processing import image_url
from app.models import Product, ProductImage
from app.models.catalog import VISIBLE_STATUSES
from app.supplier.client import SupplierError

router = APIRouter()
MAX_UPLOAD = 15 << 20


class Sample(BaseModel):
    image_id: int
    sku: int
    name: str
    variant: str  # watermark variant found by the pipeline, "none" if no watermark
    thumb: str


class SampleGroup(BaseModel):
    variant: str
    total: int  # processed photos of this variant (matching the search)
    items: list[Sample]


@router.post("/lab/watermark")
async def lab_watermark(
    request: Request,
    session: Session,
    file: Annotated[UploadFile | None, File()] = None,
    image_id: Annotated[int | None, Form()] = None,
) -> dict[str, Any]:
    """Either an uploaded image or a product photo by id (downloaded from the supplier as is)."""
    if image_id is not None:
        img = await session.get(ProductImage, image_id)
        if img is None:
            raise HTTPException(404, "Image not found")
        try:
            client = await ondemand_client(request, session)
            data = await client.fetch_image(img.source_url, size="original")
        except SupplierError as e:
            raise HTTPException(502, f"Поставщик не отдал фото: {e}") from e
    elif file is not None:
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "Файл больше 15 МБ")
    else:
        raise HTTPException(422, "Нужен файл или image_id")
    try:
        return await run_in_threadpool(analyze, data)
    except OSError as e:  # PIL: not an image
        raise HTTPException(422, "Не удалось прочитать изображение") from e


@router.get("/lab/watermark/samples", response_model=list[SampleGroup])
async def lab_samples(
    session: Session,
    per_variant: Annotated[int, Query(ge=1, le=60)] = 8,
    variant: str | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    seed: Annotated[int | None, Query(ge=0, le=2**31 - 1)] = None,
    q: str | None = None,
) -> list[SampleGroup]:
    """Processed photos of every watermark variant the pipeline has met, to try in one click.

    Newest first, or in an order shuffled by `seed`; `variant` + `offset` page through one group.
    `q` is a photo id or product SKU (digits) or a part of the product name."""
    group = func.coalesce(ProductImage.wm_template, "none")
    # multiplicative hashing: a stable pseudo-random order per seed, so `offset` pages through it
    shuffled = ((cast(ProductImage.id, BigInteger) + (seed or 0)) * 1103515245) % 2147483647
    conds = [ProductImage.status.in_(VISIBLE_STATUSES)]
    if variant:
        conds.append(group == variant)
    term = (q or "").strip()
    if term:
        match = Product.search_text.like(like(term), escape="\\")
        if term.isdigit() and int(term) < 2**31:  # a photo id or SKU, or digits of a model name
            match = or_(ProductImage.id == int(term), ProductImage.sku == int(term), match)
        conds.append(match)
    base = select(ProductImage).join(Product, Product.sku == ProductImage.sku).where(*conds)

    counts = base.with_only_columns(ProductImage.wm_template, func.count()).group_by(ProductImage.wm_template)
    totals = {v or "none": n for v, n in (await session.execute(counts)).all()}
    ranked = base.with_only_columns(
        ProductImage.id,
        ProductImage.sku,
        ProductImage.version,
        Product.name,
        group.label("variant"),
        func.row_number()
        .over(partition_by=group, order_by=shuffled if seed is not None else ProductImage.id.desc())
        .label("n"),
    ).subquery()
    rows = (
        await session.execute(
            select(ranked)
            .where(ranked.c.n > offset, ranked.c.n <= offset + per_variant)
            .order_by(ranked.c.variant, ranked.c.n)
        )
    ).all()
    media = get_settings().media_url
    groups: dict[str, SampleGroup] = {}
    for r in rows:
        g = groups.setdefault(r.variant, SampleGroup(variant=r.variant, total=totals.get(r.variant, 0), items=[]))
        g.items.append(
            Sample(image_id=r.id, sku=r.sku, name=r.name, variant=r.variant, thumb=image_url(media, r.id, "md", r.version))
        )
    return list(groups.values())
