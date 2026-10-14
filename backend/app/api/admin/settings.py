"""Runtime settings sections (shop contacts, photo loading), stored in `site_settings`.
Markup rules are kept per supplier: suppliers.py."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.api.admin.common import Session
from app.site_settings import SETTINGS, get_settings_obj, save_settings_obj

router = APIRouter()


@router.get("/settings/{key}")
async def get_setting(key: str, session: Session) -> dict[str, Any]:
    model = SETTINGS.get(key) or _404()
    return (await get_settings_obj(session, model)).model_dump(mode="json")


@router.put("/settings/{key}")
async def put_setting(key: str, body: dict[str, Any], session: Session) -> dict[str, Any]:
    model = SETTINGS.get(key) or _404()
    try:
        obj = model.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False, include_input=False)) from e
    await save_settings_obj(session, obj)
    await session.commit()
    return obj.model_dump(mode="json")


def _404():
    raise HTTPException(404, "Unknown settings section")
