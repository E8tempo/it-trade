"""Client organizations: the check by a manager, their people and their contracts with the shop.

An approved organization's people see its wholesale prices and order for it; a rejected one sees the reason in the
account. Orders placed for an organization keep its requisites, so editing or deleting it here does not change them.
"""

import re
from datetime import date, datetime
from typing import Annotated, Self

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.account import OrganizationIn, OrganizationOut
from app.api.admin.common import Admin, Page, Session, like
from app.api.admin.orders import OrderListItem, author_name, list_item
from app.models import Contract, ContractTerms, MemberRole, Order, Organization, OrganizationMember, OrganizationStatus, User
from app.auth import normalize_email
from app.models.base import utcnow

router = APIRouter()

RECENT_ORDERS = 20


class Person(BaseModel):
    """A user of the site working for the organization."""

    id: int
    email: str
    name: str | None
    phone: str | None

    @classmethod
    def of(cls, u: User) -> "Person":
        return cls(id=u.id, email=u.email, name=u.name, phone=u.phone)


class Member(Person):
    role: MemberRole
    added_at: datetime


class OrganizationListItem(BaseModel):
    id: int
    name: str
    inn: str
    kpp: str | None
    status: OrganizationStatus
    owner: Person | None  # its head (the first one)
    members: int
    contracts: int  # active ones
    created_at: datetime


class OrganizationPage(Page[OrganizationListItem]):
    counts: dict[str, int]  # organizations per status, for the filter tabs


class AdminOrganization(OrganizationOut):
    members: list[Member]
    reviewed_at: datetime | None
    reviewed_by: str | None
    updated_at: datetime
    orders: list[OrderListItem]  # the latest ones placed for it


class ReviewIn(BaseModel):
    status: OrganizationStatus
    note: str | None = Field(None, max_length=2000, description="Why it is rejected: the customer sees it")

    @model_validator(mode="after")
    def _reason(self) -> Self:
        self.note = (self.note or "").strip() or None
        if self.status == OrganizationStatus.rejected and not self.note:
            raise ValueError("Укажите причину отказа: клиент увидит её в личном кабинете")
        if self.status != OrganizationStatus.rejected:
            self.note = None
        return self


class MemberIn(BaseModel):
    email: EmailStr
    role: MemberRole = MemberRole.buyer


class RoleIn(BaseModel):
    role: MemberRole


class ContractIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    number: str = Field(min_length=1, max_length=64)
    signed_on: date
    terms: ContractTerms = ContractTerms.prepayment
    deferral_days: int | None = Field(None, ge=1, le=365)
    is_active: bool = True

    @model_validator(mode="after")
    def _deferral(self) -> Self:
        if self.terms == ContractTerms.deferred and self.deferral_days is None:
            raise ValueError("Укажите срок отсрочки платежа в днях")
        if self.terms == ContractTerms.prepayment:
            self.deferral_days = None
        return self


async def _load(session: Session, org_id: int) -> Organization:
    org = await session.scalar(
        select(Organization).where(Organization.id == org_id).options(selectinload(Organization.contracts), selectinload(Organization.members))
    )
    if org is None:
        raise HTTPException(404, "Организация не найдена")
    return org


async def _users(session: Session, ids: set[int]) -> dict[int, User]:
    return {u.id: u for u in await session.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


async def _out(session: Session, org: Organization) -> AdminOrganization:
    users = await _users(session, {m.user_id for m in org.members})
    orders = await session.scalars(
        select(Order)
        .where(Order.organization_id == org.id)
        .options(selectinload(Order.items))
        .order_by(Order.id.desc())
        .limit(RECENT_ORDERS)
    )
    return AdminOrganization(
        **OrganizationOut.of(org).model_dump(),
        members=[Member(**Person.of(users[m.user_id]).model_dump(), role=m.role, added_at=m.created_at) for m in org.members],
        reviewed_at=org.reviewed_at,
        reviewed_by=org.reviewed_by,
        updated_at=org.updated_at,
        orders=[list_item(o) for o in orders],
    )


async def _contract(session: Session, contract_id: int) -> Contract:
    c = await session.get(Contract, contract_id)
    if c is None:
        raise HTTPException(404, "Договор не найден")
    return c


async def _reloaded(session: Session, org_id: int) -> AdminOrganization:
    session.expunge_all()
    return await _out(session, await _load(session, org_id))


@router.get("/organizations", response_model=OrganizationPage)
async def list_organizations(
    session: Session,
    status: OrganizationStatus | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 30,
):
    stmt = select(Organization)
    if status:
        stmt = stmt.where(Organization.status == status)
    if q and q.strip():
        by_email = select(OrganizationMember.organization_id).join(User, User.id == OrganizationMember.user_id)
        conds = [
            func.lower(Organization.name).like(like(q), escape="\\"),
            Organization.id.in_(by_email.where(User.email.ilike(like(q), escape="\\"))),
        ]
        if len(digits := re.sub(r"\D", "", q)) >= 4:  # part of an ИНН, not a digit of an e-mail
            conds.append(Organization.inn.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    active = (
        select(func.count())
        .select_from(Contract)
        .where(Contract.organization_id == Organization.id, Contract.is_active)
        .correlate(Organization)
        .scalar_subquery()
    )
    rows = (
        await session.execute(
            stmt.add_columns(active)
            .options(selectinload(Organization.members))
            .order_by(Organization.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()
    counts = dict((await session.execute(select(Organization.status, func.count()).group_by(Organization.status))).all())
    heads = {o.id: next((m.user_id for m in o.members if m.role == MemberRole.owner), None) for o, _ in rows}
    users = await _users(session, {u for u in heads.values() if u is not None})
    items = [
        OrganizationListItem(
            id=o.id,
            name=o.name,
            inn=o.inn,
            kpp=o.kpp,
            status=o.status,
            owner=Person.of(users[heads[o.id]]) if heads[o.id] in users else None,
            members=len(o.members),
            contracts=n,
            created_at=o.created_at,
        )
        for o, n in rows
    ]
    return OrganizationPage(items=items, total=total, page=page, per_page=per_page, counts=counts)


@router.get("/organizations/{org_id}", response_model=AdminOrganization)
async def get_organization(org_id: int, session: Session):
    return await _out(session, await _load(session, org_id))


@router.put("/organizations/{org_id}", response_model=AdminOrganization)
async def edit_organization(org_id: int, body: OrganizationIn, session: Session):
    """Corrects the requisites; the status stays."""
    org = await _load(session, org_id)
    for k, v in body.model_dump().items():
        setattr(org, k, v)
    await session.commit()
    return await _reloaded(session, org_id)


@router.post("/organizations/{org_id}/review", response_model=AdminOrganization)
async def review_organization(org_id: int, body: ReviewIn, session: Session, admin: Admin):
    """Approves (wholesale prices for its customer), rejects with a reason, or returns it to the check."""
    org = await _load(session, org_id)
    org.status, org.review_note = body.status, body.note
    pending = body.status == OrganizationStatus.pending
    org.reviewed_at, org.reviewed_by = (None, None) if pending else (utcnow(), author_name(admin))
    await session.commit()
    return await _reloaded(session, org_id)


@router.delete("/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(org_id: int, session: Session):
    """With its contracts. Orders placed for it keep its requisites."""
    await session.delete(await _load(session, org_id))
    await session.commit()


def _keeps_a_head(org: Organization, user_id: int, new_role: MemberRole | None) -> None:
    """An organization always has a head: 409 when the change would leave it without one."""
    heads = {m.user_id for m in org.members if m.role == MemberRole.owner}
    if heads == {user_id} and new_role != MemberRole.owner:
        raise HTTPException(409, "У организации должен остаться руководитель")


@router.post("/organizations/{org_id}/members", response_model=AdminOrganization, status_code=status.HTTP_201_CREATED)
async def add_member(org_id: int, body: MemberIn, session: Session):
    """Adds a registered user to the organization (a new person of the company registers first)."""
    org = await _load(session, org_id)
    user = await session.scalar(select(User).where(User.email == normalize_email(body.email)))
    if user is None:
        raise HTTPException(404, "Пользователь с таким e-mail не зарегистрирован")
    if org.role_of(user.id) is not None:
        raise HTTPException(409, "Этот пользователь уже в организации")
    org.members.append(OrganizationMember(user_id=user.id, role=body.role))
    await session.commit()
    return await _reloaded(session, org_id)


@router.put("/organizations/{org_id}/members/{user_id}", response_model=AdminOrganization)
async def set_member_role(org_id: int, user_id: int, body: RoleIn, session: Session):
    org = await _load(session, org_id)
    member = next((m for m in org.members if m.user_id == user_id), None)
    if member is None:
        raise HTTPException(404, "Сотрудник не найден")
    _keeps_a_head(org, user_id, body.role)
    member.role = body.role
    await session.commit()
    return await _reloaded(session, org_id)


@router.delete("/organizations/{org_id}/members/{user_id}", response_model=AdminOrganization)
async def remove_member(org_id: int, user_id: int, session: Session):
    """The user no longer sees the organization's prices and orders; their orders stay with it."""
    org = await _load(session, org_id)
    member = next((m for m in org.members if m.user_id == user_id), None)
    if member is None:
        raise HTTPException(404, "Сотрудник не найден")
    _keeps_a_head(org, user_id, None)
    org.members.remove(member)
    await session.commit()
    return await _reloaded(session, org_id)


@router.post("/organizations/{org_id}/contracts", response_model=AdminOrganization, status_code=status.HTTP_201_CREATED)
async def add_contract(org_id: int, body: ContractIn, session: Session):
    org = await _load(session, org_id)
    org.contracts.append(Contract(**body.model_dump()))
    await session.commit()
    return await _reloaded(session, org_id)


@router.put("/contracts/{contract_id}", response_model=AdminOrganization)
async def edit_contract(contract_id: int, body: ContractIn, session: Session):
    """Also closes a contract (`is_active: false`): it is no longer offered at checkout."""
    c = await _contract(session, contract_id)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    await session.commit()
    return await _reloaded(session, c.organization_id)


@router.delete("/contracts/{contract_id}", response_model=AdminOrganization)
async def delete_contract(contract_id: int, session: Session):
    """Orders placed under it keep its number and date."""
    c = await _contract(session, contract_id)
    org_id = c.organization_id
    await session.delete(c)
    await session.commit()
    return await _reloaded(session, org_id)

