"""Admin API. Every endpoint requires a JWT of a user with the admin role."""

from fastapi import APIRouter, Depends

from app.api.admin import dashboard, lab, orders, pricing, products, settings
from app.api.deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])
for module in (dashboard, settings, pricing, products, orders, lab):
    router.include_router(module.router)
