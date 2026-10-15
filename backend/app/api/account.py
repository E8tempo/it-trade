"""A client's account: the organizations the user works for.

An organization is registered with its first user, who becomes its owner (the head); more organizations can be
added later. A manager checks each one in the admin panel and enters its contracts with the shop; its people see
prices and order only once it is approved. One record per company: an ИНН (+ КПП) already registered is refused,
its head adds more people. Changing the requisites of a checked organization sends it for a check again.
"""

import re
from datetime import datetime
from typing import Annotated, Self

from fastapi import APIRouter, HTTPException, Path, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, Session
from app.api.schemas import ContractRef
from app.models import Contract, MemberRole, Organization, OrganizationMember, OrganizationStatus, User
from app.models.organizations import KPP_RE, valid_inn, valid_ogrn

router = APIRouter(prefix="/api/account", tags=["account"])

MAX_ORGANIZATIONS = 20  # per user
MAX_ID = 2**31 - 1
REQUISITES = ("name", "inn", "kpp", "ogrn", "address")
ALREADY_REGISTERED = "Организация с этим ИНН уже работает с нами. Попросите её руководителя добавить вас в сотрудники или напишите нам."
OWNER_ONLY = "Это может только руководитель организации"


class OrganizationIn(BaseModel):
    """Requisites of an organization (the customer's form and the admin panel's). Spaces inside the numbers
    are dropped; КПП is optional, and a sole trader (12-digit ИНН) has none."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=255)
    inn: str = Field(max_length=32)
    kpp: str | None = Field(None, max_length=32)
    ogrn: str | None = Field(None, max_length=32)
    address: str | None = Field(None, max_length=512)

    @field_validator("inn", "kpp", "ogrn", mode="before")
    @classmethod
    def _compact(cls, v: object) -> object:
        if isinstance(v, str):
            v = "".join(v.split()).upper()
            return v or None
        return v

    @field_validator("address", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not re.fullmatch(r"\d{10}|\d{12}", self.inn, re.ASCII):
            raise ValueError("ИНН — 10 цифр у организации или 12 у ИП")
        if not valid_inn(self.inn):
            raise ValueError("Контрольная цифра ИНН не сходится — похоже, в номере опечатка")
        company = len(self.inn) == 10
        if not company:
            self.kpp = None
        elif self.kpp and not KPP_RE.fullmatch(self.kpp):
            raise ValueError("Проверьте КПП: 9 символов")
        if self.ogrn and (len(self.ogrn) != (13 if company else 15) or not valid_ogrn(self.ogrn)):
            raise ValueError("Проверьте ОГРН: у организации 13 цифр" if company else "Проверьте ОГРНИП: 15 цифр")
        return self


class ContractOut(ContractRef):
    is_active: bool

    @classmethod
    def of(cls, c: Contract) -> "ContractOut":
        return cls(id=c.id, number=c.number, signed_on=c.signed_on, terms=c.terms, deferral_days=c.deferral_days, is_active=c.is_active)


class OrganizationOut(BaseModel):
    id: int
    name: str
    inn: str
    kpp: str | None
    ogrn: str | None
    address: str | None
    status: OrganizationStatus
    review_note: str | None  # why a manager rejected it
    created_at: datetime
    contracts: list[ContractOut]

    @classmethod
    def of(cls, o: Organization) -> "OrganizationOut":
        return cls(
            id=o.id,
            name=o.name,
            inn=o.inn,
            kpp=o.kpp,
            ogrn=o.ogrn,
            address=o.address,
            status=o.status,
            review_note=o.review_note,
            created_at=o.created_at,
            contracts=[ContractOut.of(c) for c in o.contracts],
        )


class MyOrganizationOut(OrganizationOut):
    role: MemberRole  # the user's role in it

    @classmethod
    def mine(cls, o: Organization, user: User) -> "MyOrganizationOut":
        return cls(**OrganizationOut.of(o).model_dump(), role=o.role_of(user.id))


OrgId = Annotated[int, Path(ge=1, le=MAX_ID)]
_LOAD = (selectinload(Organization.contracts), selectinload(Organization.members))


async def _member_of(session: AsyncSession, user: User, org_id: int, owner: bool = False) -> Organization:
    """An organization of the user (404 for others); `owner`: only its head may do this (403)."""
    org = await session.scalar(
        select(Organization)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(Organization.id == org_id, OrganizationMember.user_id == user.id)
        .options(*_LOAD)
    )
    if org is None:
        raise HTTPException(404, "Организация не найдена")
    if owner and org.role_of(user.id) != MemberRole.owner:
        raise HTTPException(403, OWNER_ONLY)
    return org


async def is_registered(session: AsyncSession, inn: str, kpp: str | None = None, except_id: int | None = None) -> bool:
    """The company is already a client: the same ИНН with the same КПП, or either without one."""
    stmt = select(Organization.id).where(Organization.inn == inn)
    if kpp:
        stmt = stmt.where(or_(Organization.kpp == kpp, Organization.kpp.is_(None)))
    if except_id is not None:
        stmt = stmt.where(Organization.id != except_id)
    return await session.scalar(stmt.limit(1)) is not None


async def check_not_registered(session: AsyncSession, inn: str, kpp: str | None, except_id: int | None = None) -> None:
    """409 when the company is already a client (is_registered)."""
    if await is_registered(session, inn, kpp, except_id):
        raise HTTPException(409, ALREADY_REGISTERED)


async def create_organization(session: AsyncSession, user: User, body: OrganizationIn) -> Organization:
    """A new organization headed by the user, for a manager to check. The caller commits."""
    await check_not_registered(session, body.inn, body.kpp)
    org = Organization(**body.model_dump(), status=OrganizationStatus.pending, contracts=[], members=[])
    org.members.append(OrganizationMember(user_id=user.id, role=MemberRole.owner))
    session.add(org)
    return org


@router.get("/organizations", response_model=list[MyOrganizationOut])
async def my_organizations(user: CurrentUser, session: Session, response: Response):
    rows = await session.scalars(
        select(Organization)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user.id)
        .options(*_LOAD)
        .order_by(OrganizationMember.created_at, Organization.id)
    )
    response.headers["Cache-Control"] = "no-store"
    return [MyOrganizationOut.mine(o, user) for o in rows]


@router.post("/organizations", response_model=MyOrganizationOut, status_code=status.HTTP_201_CREATED)
async def add_organization(body: OrganizationIn, user: CurrentUser, session: Session):
    """Adds another organization headed by the user, for a manager to check."""
    count = await session.scalar(select(func.count()).select_from(OrganizationMember).where(OrganizationMember.user_id == user.id)) or 0
    if count >= MAX_ORGANIZATIONS:
        raise HTTPException(409, f"Можно добавить не больше {MAX_ORGANIZATIONS} организаций")
    org = await create_organization(session, user, body)
    await session.commit()
    return MyOrganizationOut.mine(org, user)


@router.put("/organizations/{org_id}", response_model=MyOrganizationOut)
async def edit_organization(org_id: OrgId, body: OrganizationIn, user: CurrentUser, session: Session):
    """New requisites (the head only). A checked (or rejected) organization goes to a manager for a check again."""
    org = await _member_of(session, user, org_id, owner=True)
    data = body.model_dump()
    if all(getattr(org, k) == data[k] for k in REQUISITES):
        return MyOrganizationOut.mine(org, user)
    await check_not_registered(session, body.inn, body.kpp, except_id=org.id)
    for k in REQUISITES:
        setattr(org, k, data[k])
    org.status, org.review_note, org.reviewed_at, org.reviewed_by = OrganizationStatus.pending, None, None, None
    await session.commit()
    return MyOrganizationOut.mine(org, user)


@router.delete("/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(org_id: OrgId, user: CurrentUser, session: Session):
    """The head only. Orders placed for it keep its requisites. One with contracts is deleted by a manager only."""
    org = await _member_of(session, user, org_id, owner=True)
    if org.contracts:
        raise HTTPException(409, "У организации есть договоры с нами: удалить её может только менеджер")
    await session.delete(org)
    await session.commit()
