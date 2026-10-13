"""Catalog loading page: readiness checks, progress of the supplier syncs and of the photo queue,
the trial batch, the quality of the processed photos and the photos that failed.

The counts over the whole catalog (~390k products, ~1.4M photo records: a few hundred ms on Postgres,
seconds on SQLite) are kept for COUNTS_TTL seconds; after that the old ones are returned at once while
fresh ones are counted in the background. Everything else is read on every request.
"""

import asyncio
import os
import re
import shutil
import time
from collections import Counter
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.exc import SQLAlchemyError

from app.api.admin.common import Session
from app.config import BASE_DIR, get_settings
from app.db import SessionLocal
from app.images.processing import SIZES, VERSION, image_path, image_url
from app.images.watermark import default_remover
from app.models import Category, JobState, Product, ProductImage
from app.models.base import utcnow
from app.models.catalog import VISIBLE_STATUSES, ImageStatus
from app.site_settings import SITE_RPS_MIN, ImageSettings, ShopSettings, get_settings_obj
from app.supplier.client import IMAGE_RPS_LIMIT
from app.sync.images import LIST_BATCH
from app.worker import HEARTBEAT_EVERY, TRIAL, WORKER

router = APIRouter()

COUNTS_TTL = 30.0  # seconds
LEFT_VISIBLE = 10.0  # mark left (luma levels per unit of alpha) above which the letters usually show
PHOTO_BYTES = 55_000  # both sizes of a photo, until enough photos are processed to measure it
SPEED_WINDOW = timedelta(minutes=10)  # the processing speed is measured over (at most) this time
SPEED_IDLE = timedelta(minutes=1)  # nothing processed for this long: the speed is not measured
SYNC_JOBS = {"categories": "Категории", "products": "Каталог товаров", "stock": "Цены и наличие", "image_lists": "Списки фото"}
PHASES = {"download": "скачивание файла каталога", "import": "запись товаров в базу"}

_counts: dict[int, tuple[float, dict[str, Any]]] = {}  # per_product -> (counted at, counts)
_recounts: dict[int, asyncio.Task] = {}


def clear_cache() -> None:
    """The next request counts everything again before it answers."""
    _counts.clear()


async def catalog_counts(session, per_product: int) -> dict[str, Any]:
    hit = _counts.get(per_product)
    if hit is None:  # the first request, or another number of photos per product
        counts = await _count_catalog(session, per_product)
        _counts[per_product] = (time.monotonic(), counts)
        return counts
    if time.monotonic() - hit[0] > COUNTS_TTL and per_product not in _recounts:
        _recounts[per_product] = asyncio.create_task(_recount(per_product))
    return hit[1]


async def _recount(per_product: int) -> None:
    try:
        async with SessionLocal() as session:
            _counts[per_product] = (time.monotonic(), await _count_catalog(session, per_product))
    finally:
        _recounts.pop(per_product, None)


async def _count_catalog(session, per_product: int) -> dict[str, Any]:
    p = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(Product.has_image),
                func.count().filter(Product.in_stock),
                func.count().filter(Product.in_stock, Product.has_image),
                func.count().filter(Product.in_stock, Product.has_image, Product.images_synced_at.is_not(None)),
                func.count().filter(Product.in_stock, Product.has_image, Product.images_synced_at.is_not(None), Product.main_image_id.is_(None)),
                func.count().filter(Product.in_stock, Product.price.is_(None)),
            ).where(Product.is_active)
        )
    ).one()
    keys = ("active", "with_photos", "in_stock", "stock_photos", "lists_done", "no_photos", "without_price")
    categories = await session.scalar(select(func.count()).select_from(Category).where(Category.is_active)) or 0

    # The photos that are loaded and shown (the first per_product of each in-stock product) in one pass:
    # by status and main or not, with how many are of an older processing version and the quality.
    is_main = ProductImage.id == Product.main_image_id
    rows = (
        await session.execute(
            select(
                ProductImage.status,
                is_main,
                func.count(),
                func.count().filter(or_(ProductImage.algo_version.is_(None), ProductImage.algo_version < VERSION)),
                func.count().filter(ProductImage.wm_left > LEFT_VISIBLE),
                func.count().filter(ProductImage.wm_template.is_(None), ProductImage.algo_version.is_not(None)),
                func.count().filter(ProductImage.algo_version.is_not(None)),
            )
            .select_from(Product)
            .join(ProductImage, ProductImage.sku == Product.sku)
            .where(Product.is_active, Product.in_stock, ProductImage.position < per_product)
            .group_by(ProductImage.status, is_main)
        )
    ).all()
    main: Counter[str] = Counter()
    gallery: Counter[str] = Counter()
    redo = left = no_mark = checked = 0
    for status, is_main_photo, n, old, n_left, n_no_mark, n_checked in rows:
        (main if is_main_photo else gallery)[status] += n
        if status in VISIBLE_STATUSES:
            redo += n if status == ImageStatus.stale else old  # stale: queued again from the admin panel
            left, no_mark, checked = left + n_left, no_mark + n_no_mark, checked + n_checked
    return {
        **dict(zip(keys, p, strict=True)),
        "categories": categories,
        "main": main,
        "gallery": gallery,
        "redo": redo,
        "quality": {"checked": checked, "visible_left": left, "no_mark": no_mark, "left_threshold": LEFT_VISIBLE},
        "failed": await _failed(session),
    }


# --- the page ----------------------------------------------------------------------------------


@router.get("/loading")
async def loading(session: Session) -> dict[str, Any]:
    s = get_settings()
    now = utcnow()
    cfg = await get_settings_obj(session, ImageSettings)
    jobs = {j.name: j for j in (await session.scalars(select(JobState))).all()}
    worker = _worker(jobs.get(WORKER), now)
    trial = await _trial(session, jobs.get(TRIAL))
    c = await catalog_counts(session, cfg.per_product)

    lists_left = max(0, c["stock_photos"] - c["lists_done"])
    # the photo stages know what to load only after the catalog, the stock and the photo lists
    synced = all(jobs.get(k) and jobs[k].last_success_at for k in ("products", "stock", "image_lists"))
    known = synced and not lists_left
    main, gallery = c["main"], c["gallery"]
    # photos that can be loaded: the failed ones are counted apart; lists not read yet: estimated
    main_failed = main[ImageStatus.failed]
    main_total = sum(main.values()) - main_failed + lists_left
    main_done = main[ImageStatus.ready] + main[ImageStatus.stale]
    gallery_failed = gallery[ImageStatus.failed]
    gallery_known = sum(gallery.values())
    with_lists = max(1, c["lists_done"] - c["no_photos"])
    gallery_total = gallery_known - gallery_failed + round(lists_left * gallery_known / with_lists)
    gallery_done = gallery[ImageStatus.ready] + gallery[ImageStatus.stale]
    visible, redo = main_done + gallery_done, c["redo"]

    # photos per second over the last minutes: since the first photo of the window, so it is right
    # soon after a start too; nothing processed in the last minute (paused, idle) means no measure
    recent, first, last = (
        await session.execute(
            select(func.count(), func.min(ProductImage.processed_at), func.max(ProductImage.processed_at)).where(
                ProductImage.processed_at >= now - SPEED_WINDOW
            )
        )
    ).one()
    measured = None
    if recent >= 10 and now - last <= SPEED_IDLE:
        measured = recent / max(30.0, (now - first).total_seconds())
    speed, speed_source = _speed(measured, cfg, trial)

    main_left = max(0, main_total - main_done)
    gallery_left = max(0, gallery_total - gallery_done) if cfg.gallery else 0
    redo_left = redo if cfg.reprocess else 0

    def eta(*parts: int) -> float | None:
        return sum(parts) / speed if speed else None

    photos_running = worker["alive"] and not cfg.paused
    lists = _sync_stage("image_lists", jobs, "какие фото у каких товаров в наличии, по 100 товаров за запрос")
    if lists_left and lists["status"] == "done":
        lists["status"] = "running" if worker["alive"] else "error"
    stages = [
        _sync_stage("categories", jobs, _plural(c["categories"], ("категория", "категории", "категорий"))),
        _sync_stage("products", jobs, f"{_plural(c['active'], ('товар', 'товара', 'товаров'))}, из них с фото {_n(c['with_photos'])}"),
        _sync_stage("stock", jobs, f"в наличии {_n(c['in_stock'])}"),
        {
            **lists,
            "done": c["lists_done"],
            "total": c["stock_photos"],
            # 2 requests/s of 100 products, runs of 20000 every 2 minutes: ~1.1 s per 100 products
            "eta_seconds": lists_left / LIST_BATCH * 1.1 if lists_left else None,
        },
        {
            "key": "main",
            "title": "Главные фото",
            "detail": "по одному на товар в наличии — с ними товар появляется в каталоге с фото",
            "status": _photo_status(main_left, photos_running, cfg.paused, worker["alive"], known),
            "done": main_done,
            "total": main_total,
            "failed": main_failed,
            "estimated": lists_left > 0,
            "eta_seconds": eta(main_left) if main_left else None,
        },
        {
            "key": "gallery",
            "title": "Остальные фото",
            "detail": f"до {cfg.per_product} фото на товар, после всех главных: сначала вторые, потом третьи…",
            "status": "off"
            if not cfg.gallery
            else _photo_status(gallery_left, photos_running and not main_left, cfg.paused, worker["alive"], known),
            "done": gallery_done,
            "total": gallery_total,
            "failed": gallery_failed,
            "estimated": lists_left > 0,
            "eta_seconds": eta(main_left, gallery_left) if gallery_left else None,
        },
        {
            "key": "redo",
            "title": f"Переобработка до версии {VERSION}",
            "detail": "фото, сделанные прошлой версией обработки или поставленные в очередь заново; до замены на сайте старые",
            "status": "off"
            if not cfg.reprocess and not redo
            else _photo_status(redo, photos_running and not main_left and not gallery_left, cfg.paused, worker["alive"], visible > 0),
            "done": visible - redo,
            "total": visible,
            "failed": 0,
            "estimated": False,
            "eta_seconds": eta(main_left, gallery_left, redo_left) if redo_left else None,
        },
    ]

    left_bytes = (main_left + gallery_left) * await _photo_bytes(session)
    return {
        "generated_at": now,
        "version": VERSION,
        "settings": cfg.model_dump(),
        "limits": {
            "download_rps_max": IMAGE_RPS_LIMIT - SITE_RPS_MIN,
            "supplier_rps": IMAGE_RPS_LIMIT,
            "web_concurrency": s.web_concurrency,
        },
        "worker": worker,
        "overview": {
            "products": c["active"],
            "in_stock": c["in_stock"],
            "stock_photos": c["stock_photos"],
            "photos_done": main_done + (gallery_done if cfg.gallery else 0),
            "photos_total": main_total + (gallery_total if cfg.gallery else 0),
            "photos_estimated": lists_left > 0,
            "eta_seconds": eta(main_left, gallery_left) if main_left or gallery_left else None,
        },
        "speed": {
            "photos_per_second": speed,
            "source": speed_source,
            "last_10_min": recent,
        },
        "checks": await _checks(session, jobs, worker, trial, cfg, left_bytes, c["without_price"]),
        "stages": stages,
        "trial": trial,
        "quality": c["quality"],
        "failed": c["failed"],
    }


def _speed(measured: float | None, cfg: ImageSettings, trial: dict | None = None) -> tuple[float, str]:
    """Photos per second for the estimates: measured while the worker loads photos, otherwise the
    expected one (the download rate, or less if the trial batch showed the CPU cannot keep up)."""
    if measured:
        return round(measured, 2), "measured"
    expected = cfg.download_rps
    if trial and trial.get("capacity"):
        expected = min(expected, trial["capacity"])
    return round(expected, 2), "expected"


def _photo_status(left: int, running: bool, paused: bool, alive: bool, known: bool = True) -> str:
    """`known`: what there is to load is known (otherwise nothing left means nothing found yet)."""
    if not left:
        return "done" if known else "waiting"
    if not alive:
        return "error"
    if paused:
        return "paused"
    return "running" if running else "waiting"


def _sync_stage(key: str, jobs: dict[str, JobState], detail: str) -> dict[str, Any]:
    j = jobs.get(key)
    if j is None or j.last_started_at is None:
        status = "waiting"
    elif j.last_finished_at is None or j.last_finished_at < j.last_started_at:
        status = "running"
    elif j.last_error and (j.last_success_at is None or j.last_success_at < j.last_started_at):
        status = "error"
    else:
        status = "done"
    info = (j.info or {}) if j and status == "running" else {}
    phase, share, done = info.get("phase"), info.get("progress"), info.get("detail")
    if share is not None and key == "products":  # downloading the file is ~a third of the job
        share = round(0.3 * share if phase == "download" else 0.3 + 0.7 * share, 3)
    return {
        "key": key,
        "title": SYNC_JOBS[key],
        "detail": detail,
        "status": status,
        "done": None,
        "total": None,
        "failed": 0,
        "estimated": False,
        "eta_seconds": None,
        "progress": share,
        "phase": f"{PHASES[phase]}{f', {done}' if done else ''}" if phase in PHASES else None,
        "last_success_at": j.last_success_at if j else None,
        "error": j.last_error if status == "error" and j else None,
    }


def _worker(st: JobState | None, now: datetime) -> dict[str, Any]:
    info = st.info if st else {}
    beat = datetime.fromisoformat(info["heartbeat"]) if info.get("heartbeat") else None
    return {
        "alive": beat is not None and now - beat <= timedelta(seconds=3 * HEARTBEAT_EVERY),
        "heartbeat": beat,
        "started_at": st.last_started_at if st else None,
        "activity": info.get("activity"),
        "image_workers": info.get("image_workers"),
        "cpus": info.get("cpus"),
    }


async def _trial(session, st: JobState | None) -> dict[str, Any] | None:
    if st is None:
        return None
    info = dict(st.info)
    ids = info.pop("ids", []) or []
    out: dict[str, Any] = {**info, "requested_at": info.get("requested_at"), "finished_at": st.last_finished_at}
    if ids:
        r = (
            await session.execute(
                select(
                    func.count().filter(ProductImage.status.in_(VISIBLE_STATUSES)),
                    func.count().filter(ProductImage.status == ImageStatus.failed),
                    func.count().filter(ProductImage.status.in_(VISIBLE_STATUSES), ProductImage.wm_template.is_(None)),
                    func.count().filter(ProductImage.wm_left > LEFT_VISIBLE),
                ).where(ProductImage.id.in_(ids))
            )
        ).one()
        out.update(ready=r[0], failed_photos=r[1], no_mark=r[2], visible_left=r[3])
    ms, workers = info.get("ms_median"), info.get("image_workers")
    # photos per second the CPU keeps up with: each process of the pool takes one photo at a time
    out["capacity"] = round(workers * 1000 / ms, 2) if ms and workers else None
    return out


async def _checks(session, jobs, worker, trial, cfg: ImageSettings, left_bytes: int, without_price: int) -> list[dict[str, Any]]:
    s = get_settings()
    checks = []

    def add(key: str, title: str, status: str, detail: str, hint: str | None = None) -> None:
        checks.append({"key": key, "title": title, "status": status, "detail": detail, "hint": hint})

    # supplier
    if not (s.supplier_login and s.supplier_password.get_secret_value()):
        add("supplier", "Поставщик", "error", "Логин и пароль поставщика не заданы", "SUPPLIER_LOGIN и SUPPLIER_PASSWORD в .env")
    else:
        runs = [jobs.get(k) for k in SYNC_JOBS]
        broken = [
            (SYNC_JOBS[j.name], j.last_error)
            for j in runs
            if j and j.last_error and (j.last_success_at is None or j.last_success_at < j.last_started_at)
        ]
        last = max((j.last_success_at for j in runs if j and j.last_success_at), default=None)
        if broken:
            name, error = broken[0]
            add("supplier", "Поставщик", "error", f"{name}: {error[:300]}", "Подробности — в логе воркера")
        elif last is None:
            add("supplier", "Поставщик", "wait", "Ждём первого обмена: воркер начинает с дерева категорий")
        else:
            add("supplier", "Поставщик", "ok", f"Обмен идёт, последний успешный — {_ago(last)}")

    # worker
    if worker["heartbeat"] is None:
        add("worker", "Воркер", "error", "Воркер ещё ни разу не запускался", "docker compose up -d worker")
    elif not worker["alive"]:
        add("worker", "Воркер", "error", f"Воркер не отвечает {_ago(worker['heartbeat'])}", "docker compose logs worker")
    else:
        add("worker", "Воркер", "ok", f"Работает {_ago(worker['started_at'], suffix='')}; процессов обработки фото: {worker['image_workers']}")

    # processing speed vs downloads, from the trial batch
    if trial and trial.get("capacity"):
        capacity, cpus = trial["capacity"], worker.get("cpus") or os.cpu_count() or 1
        if capacity < 0.9 * cfg.download_rps:
            add(
                "cpu",
                "Скорость обработки",
                "warn",
                f"Процессор успевает ~{_dec(capacity)} фото/с, а загрузка настроена на {_dec(cfg.download_rps)} фото/с",
                f"Ядер на сервере: {cpus}. Поставьте IMAGE_WORKERS={max(1, cpus - 1)} в .env и перезапустите воркер, или снизьте скорость загрузки",
            )
        else:
            add("cpu", "Скорость обработки", "ok", f"Процессор успевает ~{_dec(capacity)} фото/с — быстрее загрузки")
    else:
        add("cpu", "Скорость обработки", "wait", "Узнаем после пробной партии")

    # database and migrations
    dialect = session.bind.dialect.name
    try:
        current = await session.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError:
        current = None
    head = _migrations_head()
    db_name = "PostgreSQL" if dialect == "postgresql" else "SQLite" if dialect == "sqlite" else dialect
    if current != head:
        add("database", "База данных", "error", f"{db_name}: миграции не применены (база {current or '—'}, код {head})", "alembic upgrade head")
    elif dialect == "sqlite" and s.is_prod:
        add("database", "База данных", "error", "SQLite — только для разработки", "DATABASE_URL на PostgreSQL")
    else:
        add("database", "База данных", "ok", f"{db_name}, миграции применены")

    # watermark removal
    try:
        rm = default_remover()
        add("watermark", "Снятие знака", "ok", f"Версия обработки {VERSION}; шаблоны: {', '.join(t.name for t in rm.templates)}")
    except Exception as e:  # noqa: BLE001 - shown on the page
        add("watermark", "Снятие знака", "error", f"Шаблоны знака не загрузились: {e}")

    # disk
    try:
        usage = shutil.disk_usage(s.media_root)
        free, need = usage.free, left_bytes
        detail = f"Свободно {_gb(free)}, под оставшиеся фото нужно ~{_gb(need)}"
        if free < need:
            add("disk", "Место для фото", "error", detail, "Нужен диск побольше или меньше фото на товар")
        elif free < need * 1.5 + 2e9:
            add("disk", "Место для фото", "warn", detail, "Запас небольшой: база и логи тоже растут")
        else:
            add("disk", "Место для фото", "ok", detail)
    except OSError as e:
        add("disk", "Место для фото", "error", f"Папка для фото недоступна: {e}", "MEDIA_ROOT")

    # deployment mode
    if s.is_prod:
        add("mode", "Режим", "ok", "Рабочий (APP_ENV=prod)")
    else:
        add("mode", "Режим", "warn", f"Разработка (APP_ENV={s.env})", "На сервере APP_ENV=prod ставит docker compose")

    # shop
    shop = await get_settings_obj(session, ShopSettings)
    missing = [name for name, v in (("телефон", shop.phone), ("e-mail", shop.email), ("адрес", shop.address)) if not v.strip()]
    if missing:
        add("shop", "Контакты магазина", "warn", "Не заполнено: " + ", ".join(missing), "Настройки → Магазин")
    else:
        add("shop", "Контакты магазина", "ok", "Заполнены")
    if without_price:
        add("prices", "Цены", "warn", f"В наличии без цены: {without_price}", "Такие товары не продаются; цены придут со следующим обновлением наличия")
    return checks


@lru_cache
def _migrations_head() -> str | None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    return ScriptDirectory.from_config(cfg).get_current_head()


_bytes_cache: list[float] = []  # [measured at, bytes per photo]


async def _photo_bytes(session) -> int:
    """Disk taken by one photo (all sizes): the mean over recently processed ones (re-measured every
    10 minutes), or PHOTO_BYTES before enough are processed."""
    if _bytes_cache and time.monotonic() - _bytes_cache[0] < 600:
        return int(_bytes_cache[1])
    ids = (
        await session.scalars(
            select(ProductImage.id)
            .where(ProductImage.status == ImageStatus.ready, ProductImage.processed_at.is_not(None))
            .order_by(ProductImage.processed_at.desc())
            .limit(200)
        )
    ).all()
    media, sizes = get_settings().media_root, []
    for iid in ids:
        try:
            sizes.append(sum(image_path(media, iid, size).stat().st_size for size in SIZES))
        except OSError:
            continue
    value = sum(sizes) / len(sizes) if len(sizes) >= 50 else PHOTO_BYTES
    _bytes_cache[:] = [time.monotonic(), value]
    return int(value)


_HTTP = re.compile(r"HTTP (\d{3})")
REASONS = {"404": "У поставщика нет файла (HTTP 404)", "403": "Поставщик не дал скачать (HTTP 403)"}


async def _failed(session) -> dict[str, Any]:
    total = await session.scalar(select(func.count()).select_from(ProductImage).where(ProductImage.status == ImageStatus.failed)) or 0
    errors = (
        await session.scalars(select(ProductImage.error).where(ProductImage.status == ImageStatus.failed).limit(5000))
    ).all()
    reasons: Counter[str] = Counter()
    for e in errors:
        m = _HTTP.search(e or "")
        if m:
            reasons[REASONS.get(m.group(1), f"Поставщик ответил HTTP {m.group(1)}")] += 1
        else:
            reasons[re.sub(r"\d+", "N", (e or "без описания").split(": ", 1)[-1])[:120]] += 1
    return {"total": total, "reasons": [{"reason": k, "count": n} for k, n in reasons.most_common(6)]}


def _n(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def _plural(n: int, forms: tuple[str, str, str]) -> str:
    """_plural(4403, ("категория", "категории", "категорий")) -> "4 403 категории"."""
    k = 0 if n % 10 == 1 and n % 100 != 11 else 1 if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else 2
    return f"{_n(n)} {forms[k]}"


def _dec(x: float) -> str:
    """1.5 -> "1,5", 3.0 -> "3": numbers in the Russian texts of the page."""
    return f"{x:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _gb(n: float) -> str:
    """Disk sizes: "46 МБ", "6,5 ГБ"."""
    return f"{n / 1e6:.0f} МБ" if n < 1e9 else f"{n / 1e9:.1f} ГБ".replace(".", ",")


def _ago(at: datetime | None, suffix: str = " назад") -> str:
    if at is None:
        return "—"
    seconds = max(0, (utcnow() - at).total_seconds())
    if seconds < 90:
        return "только что" if suffix else "меньше минуты"
    if seconds < 5400:
        return f"{round(seconds / 60)} мин{suffix}"
    if seconds < 172800:
        return f"{round(seconds / 3600)} ч{suffix}"
    return f"{round(seconds / 86400)} дн{suffix}"


# --- actions -----------------------------------------------------------------------------------


class TrialIn(BaseModel):
    count: int = Field(200, ge=10, le=500)


@router.post("/loading/trial")
async def start_trial(body: TrialIn, session: Session) -> dict[str, Any]:
    """Asks the worker for a trial batch: random main photos of in-stock products, processed for
    real (they are not loaded again later), with the speed and the CPU time measured."""
    st = await session.get(JobState, TRIAL)
    if st is not None and st.info.get("status") in ("queued", "running"):
        raise HTTPException(409, "Пробная партия уже идёт")
    st = st or JobState(name=TRIAL, info={})
    st.info = {"status": "queued", "requested": body.count, "requested_at": utcnow().isoformat()}
    st.last_error = None
    session.add(st)
    await session.commit()
    return st.info


@router.post("/images/retry-failed")
async def retry_failed(session: Session) -> dict[str, int]:
    """Photos that failed are queued again (e.g. after the supplier fixed its files)."""
    res = await session.execute(
        update(ProductImage)
        .where(ProductImage.status == ImageStatus.failed)
        .values(status=ImageStatus.pending, attempts=0, error=None)
    )
    await session.commit()
    clear_cache()
    return {"queued": res.rowcount}


class LoadingPhoto(BaseModel):
    id: int
    sku: int
    name: str
    status: str
    wm_template: str | None
    wm_left: float | None
    error: str | None
    thumb: str | None


@router.get("/loading/photos", response_model=list[LoadingPhoto])
async def loading_photos(
    session: Session,
    kind: Literal["trial", "left", "no_mark"],
    limit: int = Query(60, ge=1, le=500),
):
    """Photos to look at: the trial batch (worst first); or of the photos shown on the site, the ones
    with the mark still showing, or the ones the detector found no mark on (some near-black marks on
    black products are missed)."""
    q = select(ProductImage, Product.name).join(Product, Product.sku == ProductImage.sku)
    if kind != "trial":
        cfg = await get_settings_obj(session, ImageSettings)
        q = q.where(Product.is_active, Product.in_stock, ProductImage.position < cfg.per_product)
    if kind == "trial":
        st = await session.get(JobState, TRIAL)
        ids = (st.info.get("ids") if st else None) or []
        q = q.where(ProductImage.id.in_(ids)).order_by(
            (ProductImage.status == ImageStatus.failed).desc(), ProductImage.wm_left.desc().nulls_last(), ProductImage.id
        )
    elif kind == "left":
        q = q.where(ProductImage.status.in_(VISIBLE_STATUSES), ProductImage.wm_left > LEFT_VISIBLE).order_by(
            ProductImage.wm_left.desc()
        )
    else:
        q = q.where(
            ProductImage.status.in_(VISIBLE_STATUSES), ProductImage.algo_version.is_not(None), ProductImage.wm_template.is_(None)
        ).order_by(ProductImage.processed_at.desc())
    media = get_settings().media_url
    return [
        LoadingPhoto(
            id=img.id,
            sku=img.sku,
            name=name,
            status=img.status,
            wm_template=img.wm_template,
            wm_left=img.wm_left,
            error=img.error if img.status == ImageStatus.failed else None,
            thumb=image_url(media, img.id, "md", img.version) if img.status in VISIBLE_STATUSES else None,
        )
        for img, name in (await session.execute(q.limit(limit))).all()
    ]
