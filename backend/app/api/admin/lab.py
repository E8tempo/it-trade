"""Algorithm lab: run the watermark removal on any photo and see every step."""

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from app.api.admin.common import Session
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
            data = await request.app.state.ondemand_client.fetch_image(img.source_url, size="original")
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


@router.get("/lab/watermark/samples", response_model=list[Sample])
async def lab_samples(session: Session, per_variant: int = 2) -> list[Sample]:
    """A few processed photos of every watermark variant the pipeline has met, to try in one click."""
    ranked = (
        select(
            ProductImage.id,
            ProductImage.sku,
            ProductImage.version,
            func.coalesce(ProductImage.wm_template, "none").label("variant"),
            func.row_number()
            .over(partition_by=func.coalesce(ProductImage.wm_template, "none"), order_by=ProductImage.id.desc())
            .label("n"),
        )
        .where(ProductImage.status.in_(VISIBLE_STATUSES))
        .subquery()
    )
    rows = (
        await session.execute(
            select(ranked, Product.name)
            .join(Product, Product.sku == ranked.c.sku)
            .where(ranked.c.n <= per_variant)
            .order_by(ranked.c.variant, ranked.c.n)
        )
    ).all()
    media = get_settings().media_url
    return [
        Sample(image_id=r.id, sku=r.sku, name=r.name, variant=r.variant, thumb=image_url(media, r.id, "sm", r.version))
        for r in rows
    ]
