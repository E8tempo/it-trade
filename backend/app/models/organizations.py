import re
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class OrganizationStatus(StrEnum):
    pending = "pending"  # added by the customer, a manager has not checked it yet
    approved = "approved"  # checked: buying for it, the customer pays the wholesale prices
    rejected = "rejected"  # the reason is in `review_note`; editing the requisites sends it for a check again


class MemberRole(StrEnum):
    owner = "owner"  # the head: requisites, employees, every order of the organization
    buyer = "buyer"  # a purchaser: catalog, cart and own orders


class Organization(TimestampMixin, Base):
    """A company or a sole trader, the shop's client. Registered together with its first user (its owner) and
    checked by a manager; until then its people see no prices. One record per company (ИНН + КПП): more people
    of the same company are its members."""

    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))  # as on documents: ООО «Ромашка», ИП Иванов И. И.
    inn: Mapped[str] = mapped_column(String(12), index=True)  # 10 digits for a company, 12 for a sole trader
    kpp: Mapped[str | None] = mapped_column(String(9))  # companies only
    ogrn: Mapped[str | None] = mapped_column(String(15))  # ОГРН (13 digits) or ОГРНИП (15)
    address: Mapped[str | None] = mapped_column(String(512))  # legal address
    status: Mapped[OrganizationStatus] = mapped_column(String(16), default=OrganizationStatus.pending, index=True)
    review_note: Mapped[str | None] = mapped_column(Text)  # why it was rejected; the customer sees it
    reviewed_at: Mapped[datetime | None]
    reviewed_by: Mapped[str | None] = mapped_column(String(255))  # the manager's name or e-mail

    contracts: Mapped[list["Contract"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan", order_by="[Contract.signed_on.desc(), Contract.id.desc()]"
    )
    members: Mapped[list["OrganizationMember"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan", order_by="[OrganizationMember.created_at, OrganizationMember.user_id]"
    )

    def role_of(self, user_id: int) -> MemberRole | None:
        """The user's role here, None for an outsider (`members` must be loaded)."""
        return next((MemberRole(m.role) for m in self.members if m.user_id == user_id), None)


class OrganizationMember(TimestampMixin, Base):
    """A person working for an organization on the site."""

    __tablename__ = "organization_members"

    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[MemberRole] = mapped_column(String(16), default=MemberRole.buyer)

    organization: Mapped[Organization] = relationship(back_populates="members")


class ContractTerms(StrEnum):
    prepayment = "prepayment"
    deferred = "deferred"  # payment within `deferral_days` after delivery


class Contract(TimestampMixin, Base):
    """A contract of an organization with the shop. Entered by a manager; the customer picks one at checkout."""

    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(64))
    signed_on: Mapped[date]
    terms: Mapped[ContractTerms] = mapped_column(String(16), default=ContractTerms.prepayment)
    deferral_days: Mapped[int | None]
    is_active: Mapped[bool] = mapped_column(default=True)  # a closed contract is kept for the orders made under it

    organization: Mapped[Organization] = relationship(back_populates="contracts")


def buyer_snapshot(org: Organization, contract: Contract | None) -> dict:
    """Order.buyer: the requisites and the contract of the order's organization as they are now."""
    return {
        "name": org.name,
        "inn": org.inn,
        "kpp": org.kpp,
        "ogrn": org.ogrn,
        "address": org.address,
        "contract": None
        if contract is None
        else {
            "id": contract.id,
            "number": contract.number,
            "signed_on": contract.signed_on.isoformat(),
            "terms": str(contract.terms),
            "deferral_days": contract.deferral_days,
        },
    }


# --- requisites -------------------------------------------------------------------------------

KPP_RE = re.compile(r"\d{4}[\dA-Z]{2}\d{3}")  # the 5th and 6th characters may be letters


def _check_digit(digits: list[int], weights: tuple[int, ...]) -> int:
    return sum(w * d for w, d in zip(weights, digits, strict=False)) % 11 % 10


def valid_inn(inn: str) -> bool:
    """ИНН: 10 digits for a company, 12 for a person or a sole trader, with the tax service's check digits."""
    if not re.fullmatch(r"\d{10}|\d{12}", inn, re.ASCII):
        return False
    d = [int(c) for c in inn]
    if len(d) == 10:
        return _check_digit(d, (2, 4, 10, 3, 5, 9, 4, 6, 8)) == d[9]
    return _check_digit(d, (7, 2, 4, 10, 3, 5, 9, 4, 6, 8)) == d[10] and _check_digit(d, (3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8)) == d[11]


def valid_ogrn(ogrn: str) -> bool:
    """ОГРН of a company (13 digits) or ОГРНИП of a sole trader (15), with the check digit."""
    if re.fullmatch(r"\d{13}", ogrn, re.ASCII):
        return int(ogrn[:12]) % 11 % 10 == int(ogrn[12])
    if re.fullmatch(r"\d{15}", ogrn, re.ASCII):
        return int(ogrn[:14]) % 13 % 10 == int(ogrn[14])
    return False
