"""Runtime settings sections (shop contacts, pricing rules), stored in `site_settings`."""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.api.admin.common import Session
from app.api.catalog import clear_caches
from app.site_settings import SETTINGS, PricingSettings, get_settings_obj, save_settings_obj
from app.sync.stock import reprice_all

router = APIRouter()


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
        background.add_task(_reprice)
    return obj.model_dump(mode="json")


async def _reprice() -> None:
    await reprice_all()
    clear_caches()


def _404():
    raise HTTPException(404, "Unknown settings section")
