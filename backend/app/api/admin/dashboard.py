"""Overview: catalog, photos, orders and the worker's jobs at a glance."""

from datetime import timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.admin.common import Session
from app.api.admin.orders import list_item
from app.models import JobState, Order, OrderStatus, Product, ProductImage
from app.models.base import utcnow

router = APIRouter()


def _jobs(rows) -> list[dict[str, Any]]:
    return [
        {
            "name": j.name,
            "last_started_at": j.last_started_at,
            "last_finished_at": j.last_finished_at,
            "last_success_at": j.last_success_at,
            "last_error": j.last_error,
            "info": j.info,
        }
        for j in rows
    ]


@router.get("/status")
async def sync_status(session: Session) -> dict[str, Any]:
    jobs = (await session.scalars(select(JobState))).all()
    images = dict((await session.execute(select(ProductImage.status, func.count()).group_by(ProductImage.status))).all())
    products = (
        await session.execute(select(func.count(), func.count().filter(Product.in_stock)).where(Product.is_active))
    ).one()
    return {"jobs": _jobs(jobs), "products": {"active": products[0], "in_stock": products[1]}, "images": images}


@router.get("/dashboard")
async def dashboard(session: Session) -> dict[str, Any]:
    p = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(Product.in_stock),
                func.count().filter(Product.is_hidden),
                func.count().filter(Product.price_override.is_not(None)),
                func.count().filter(Product.in_stock, Product.price.is_(None)),
            ).where(Product.is_active)
        )
    ).one()
    images = dict((await session.execute(select(ProductImage.status, func.count()).group_by(ProductImage.status))).all())
    variants = dict(
        (
            await session.execute(
                select(func.coalesce(ProductImage.wm_template, "none"), func.count())
                .where(ProductImage.status.in_(("ready", "stale")))
                .group_by(ProductImage.wm_template)
            )
        ).all()
    )
    by_status = dict((await session.execute(select(Order.status, func.count()).group_by(Order.status))).all())
    since = utcnow() - timedelta(days=30)
    revenue, cost, completed = (
        await session.execute(
            select(
                func.coalesce(func.sum(Order.items_total - Order.discount), 0),
                func.coalesce(func.sum(Order.cost_total), 0),
                func.count(),
            ).where(Order.status == OrderStatus.completed, Order.created_at >= since)
        )
    ).one()
    recent = await session.scalars(select(Order).options(selectinload(Order.items)).order_by(Order.id.desc()).limit(6))
    jobs = (await session.scalars(select(JobState).order_by(JobState.name))).all()
    return {
        "products": {
            "active": p[0],
            "in_stock": p[1],
            "hidden": p[2],
            "fixed_price": p[3],
            "in_stock_without_price": p[4],
        },
        "images": {"by_status": images, "by_variant": variants},
        "orders": {
            "by_status": by_status,
            "open": sum(n for s, n in by_status.items() if s not in (OrderStatus.completed, OrderStatus.cancelled)),
            "completed_30d": completed,
            "revenue_30d": Decimal(revenue),
            "margin_30d": Decimal(revenue) - Decimal(cost),
        },
        "recent_orders": [list_item(o) for o in recent],
        "jobs": _jobs(jobs),
    }
