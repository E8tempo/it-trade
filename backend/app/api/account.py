"""A client's account: the organizations the user works for.

A client registers as a private person and buys as one; whoever adds an organization becomes its owner (the head).
The form finds its requisites by ИНН in the state registers (GET /company). A manager checks each organization in
the admin panel and enters its contracts with the shop; its people buy for it, at its prices, only once it is
approved, and from then on it is the one they buy for unless they choose otherwise (app/api/cart.py: find_buyer).
One record per company: an ИНН (+ КПП) already registered is refused, its head adds more people. Changing the
requisites of a checked organization sends it for a check again.
"""

import re
import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Annotated, Self

from fastapi import APIRouter, HTTPException, Path, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.cart import choose_buyer
from app.api.deps import CurrentUser, Session
from app.api.schemas import ContractRef
from app.companies import LookupUnavailable, configured, find_company
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


def same_company(inn: str, kpp: str | None):
    """Organizations of the same company: the same ИНН with the same КПП, or either without one (a branch, with
    its own КПП, is another client)."""
    cond = Organization.inn == inn
    return cond & or_(Organization.kpp == kpp, Organization.kpp.is_(None)) if kpp else cond


async def is_registered(session: AsyncSession, inn: str, kpp: str | None = None, except_id: int | None = None) -> bool:
    """The company is already a client: an *approved* organization of it. Requests that are not checked yet do
    not count, so whoever registers someone else's ИНН first does not lock the real company out; a manager
    approves one organization per company (admin/organizations.py: review)."""
    stmt = select(Organization.id).where(same_company(inn, kpp), Organization.status == OrganizationStatus.approved)
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
    mine = select(Organization.id).join(OrganizationMember).where(OrganizationMember.user_id == user.id, same_company(body.inn, body.kpp))
    if await session.scalar(mine.limit(1)) is not None:
        raise HTTPException(409, "Эта организация уже есть в вашем кабинете")
    org = Organization(**body.model_dump(), status=OrganizationStatus.pending, contracts=[], members=[])
    org.members.append(OrganizationMember(user_id=user.id, role=MemberRole.owner))
    session.add(org)
    return org


# lookups of a user by ИНН, per API process: the registers' service is limited per day
LOOKUPS, LOOKUP_WINDOW = 30, 15 * 60
_lookups: defaultdict[int, deque[float]] = defaultdict(deque)


def _check_lookups(user_id: int) -> None:
    now = time.monotonic()
    q = _lookups[user_id]
    while q and now - q[0] > LOOKUP_WINDOW:
        q.popleft()
    if len(q) >= LOOKUPS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много запросов, попробуйте позже")
    q.append(now)


@router.get("/company")
async def company(inn: Annotated[str, Query(pattern=r"^\d{10}(\d{2})?$")], user: CurrentUser, session: Session) -> dict:
    """The new organization form's lookup of a company by ИНН. `configured`: false without a DaData key (the form
    asks for the requisites by hand, as it does when the lookup fails); `registered`: the company is a client
    already; `mine`: it is in the user's account already."""
    _check_lookups(user.id)
    try:
        found = await find_company(inn)
        available = True
    except LookupUnavailable:
        found, available = None, False
    kpp = found.kpp if found else None
    mine = select(Organization.id).join(OrganizationMember).where(OrganizationMember.user_id == user.id, same_company(inn, kpp))
    return {
        "configured": configured(),
        "available": available,
        "company": found.as_dict() if found else None,
        "registered": await is_registered(session, inn, kpp),
        "mine": await session.scalar(mine.limit(1)) is not None,
    }


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
    """Adds an organization headed by the user, for a manager to check. It becomes the user's choice on the cart:
    they buy for it as soon as it is approved, and as before until then."""
    count = await session.scalar(select(func.count()).select_from(OrganizationMember).where(OrganizationMember.user_id == user.id)) or 0
    if count >= MAX_ORGANIZATIONS:
        raise HTTPException(409, f"Можно добавить не больше {MAX_ORGANIZATIONS} организаций")
    org = await create_organization(session, user, body)
    await choose_buyer(session, user.id, org)
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
