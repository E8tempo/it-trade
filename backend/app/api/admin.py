"""Admin API (settings, sync status). Requires a JWT of a user with the admin role."""

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_session
from app.models import JobState, Product, ProductImage
from app.site_settings import SETTINGS, PricingSettings, get_settings_obj, save_settings_obj
from app.sync.stock import reprice_all

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/settings/{key}")
async def get_setting(key: str, session: Session) -> dict[str, Any]:
    model = SETTINGS.get(key) or _404()
    return (await get_settings_obj(session, model)).model_dump(mode="json")


@router.put("/settings/{key}")
async def put_setting(key: str, body: dict[str, Any], session: Session, background: BackgroundTasks) -> dict[str, Any]:
    model = SETTINGS.get(key) or _404()
    obj = model.model_validate(body)
    await save_settings_obj(session, obj)
    await session.commit()
    if model is PricingSettings:
        background.add_task(reprice_all)
    return obj.model_dump(mode="json")


@router.get("/status")
async def sync_status(session: Session) -> dict[str, Any]:
    jobs = (await session.scalars(select(JobState))).all()
    images = dict((await session.execute(select(ProductImage.status, func.count()).group_by(ProductImage.status))).all())
    products = (
        await session.execute(select(func.count(), func.count().filter(Product.in_stock)).where(Product.is_active))
    ).one()
    return {
        "jobs": [
            {
                "name": j.name,
                "last_started_at": j.last_started_at,
                "last_success_at": j.last_success_at,
                "last_error": j.last_error,
                "info": j.info,
            }
            for j in jobs
        ],
        "products": {"active": products[0], "in_stock": products[1]},
        "images": images,
    }


def _404():
    raise HTTPException(404, "Unknown settings section")
