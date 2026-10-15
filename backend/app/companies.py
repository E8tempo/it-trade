"""Requisites of a company by its ИНН, for the registration form: DaData's "find a party by id" over the state
registers (ЕГРЮЛ / ЕГРИП). Optional: without DADATA_API_KEY the form asks for the name and КПП by hand.

https://dadata.ru/api/find-party/ — free up to 10 000 requests a day.
"""

import logging
import time
from dataclasses import asdict, dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party"
CACHE_TTL = 24 * 3600.0  # the registers change slowly; a failed lookup is not cached
_cache: dict[str, tuple[float, "Company | None"]] = {}


@dataclass
class Company:
    inn: str
    kpp: str | None
    ogrn: str | None
    name: str  # short, with the legal form: ООО «Ромашка», ИП Иванов Иван Иванович
    full_name: str | None
    address: str | None
    manager: str | None  # «Генеральный директор Иванов Иван Иванович»
    sole_trader: bool
    status: str  # ACTIVE, LIQUIDATING, LIQUIDATED, BANKRUPT, REORGANIZING

    def as_dict(self) -> dict:
        return asdict(self)


class LookupUnavailable(Exception):
    """No API key, or DaData did not answer: the form falls back to manual entry."""


def configured() -> bool:
    return bool(get_settings().dadata_api_key.get_secret_value())


async def find_company(inn: str) -> Company | None:
    """The head office of the company with this ИНН (not its branches); None if the registers do not know it."""
    if not configured():
        raise LookupUnavailable("DADATA_API_KEY is not set")
    hit = _cache.get(inn)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                URL,
                json={"query": inn, "branch_type": "MAIN", "count": 1},
                headers={"Authorization": f"Token {get_settings().dadata_api_key.get_secret_value()}", "Accept": "application/json"},
            )
            r.raise_for_status()
            found = r.json().get("suggestions") or []
    except (httpx.HTTPError, ValueError) as e:
        log.warning("company lookup failed: %s", e)
        raise LookupUnavailable(str(e)) from e
    company = _parse(found[0]) if found else None
    _cache[inn] = (time.monotonic(), company)
    return company


def _parse(s: dict) -> Company:
    d = s.get("data") or {}
    name = d.get("name") or {}
    management = d.get("management") or {}
    manager = " ".join(x for x in (management.get("post"), management.get("name")) if x) or None
    return Company(
        inn=d.get("inn") or "",
        kpp=d.get("kpp") or None,
        ogrn=d.get("ogrn") or None,
        name=name.get("short_with_opf") or s.get("value") or "",
        full_name=name.get("full_with_opf") or None,
        address=(d.get("address") or {}).get("value") or None,
        manager=manager,
        sole_trader=d.get("type") == "INDIVIDUAL",
        status=(d.get("state") or {}).get("status") or "ACTIVE",
    )
