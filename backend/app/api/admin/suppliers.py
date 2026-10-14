"""Suppliers: their products and their markup rules, one set per price type."""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select

from app.api.admin.common import Session
from app.api.catalog import clear_caches
from app.models import PriceType, Product
from app.pricing import DEFAULT_SUPPLIER, SUPPLIERS, PriceRules, Supplier, get_supplier_pricing, save_supplier_pricing
from app.sync.stock import reprice_all

router = APIRouter()


class SupplierOut(BaseModel):
    code: str
    name: str
    url: str
    products: int  # active products
    in_stock: int


def supplier_or_404(code: str) -> Supplier:
    if code not in SUPPLIERS:
        raise HTTPException(404, "Supplier not found")
    return SUPPLIERS[code]


@router.get("/suppliers", response_model=list[SupplierOut])
async def list_suppliers(session: Session):
    products, in_stock = (
        await session.execute(select(func.count(), func.count().filter(Product.in_stock)).where(Product.is_active))
    ).one()
    # products are not linked to a supplier yet: every one of them is the default supplier's
    return [
        SupplierOut(
            code=s.code,
            name=s.name,
            url=s.url,
            products=products if s.code == DEFAULT_SUPPLIER else 0,
            in_stock=in_stock if s.code == DEFAULT_SUPPLIER else 0,
        )
        for s in SUPPLIERS.values()
    ]


@router.get("/suppliers/{code}/pricing")
async def get_pricing(code: str, session: Session) -> dict[str, Any]:
    supplier_or_404(code)
    return (await get_supplier_pricing(session, code)).model_dump(mode="json")


@router.put("/suppliers/{code}/pricing/{price_type}")
async def put_pricing(
    code: str, price_type: PriceType, body: dict[str, Any], session: Session, background: BackgroundTasks
) -> dict[str, Any]:
    """Saves the rules of one price type and reprices the products in the background."""
    supplier_or_404(code)
    try:
        rules = PriceRules.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False, include_input=False)) from e
    pricing = (await get_supplier_pricing(session, code)).model_copy(update={price_type.value: rules})
    await save_supplier_pricing(session, code, pricing)
    await session.commit()
    background.add_task(_reprice)
    return pricing.model_dump(mode="json")


async def _reprice() -> None:
    await reprice_all()
    clear_caches()
