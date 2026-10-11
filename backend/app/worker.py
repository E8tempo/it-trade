"""Background worker: periodic supplier syncs + continuous image processing.

    python -m app.worker
"""

import asyncio
import logging
import signal
import traceback
from collections.abc import Awaitable, Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.db import SessionLocal
from app.models import JobState
from app.models.base import utcnow
from app.supplier.client import SupplierClient, SupplierUnavailable
from app.sync.categories import sync_categories
from app.sync.images import next_pending, process_one, sync_image_lists
from app.sync.products import sync_products
from app.sync.stock import sync_stock

log = logging.getLogger("worker")
RETRY_AFTER = timedelta(minutes=10)


@dataclass
class Job:
    name: str
    run: Callable[[SupplierClient], Awaitable[dict]]
    every: timedelta | None = None  # fixed interval...
    daily: bool = False  # ...or once a day after settings.catalog_sync_hour
    after: str | None = None  # do not start before this job has succeeded at least once


def jobs() -> list[Job]:
    s = get_settings()
    return [
        Job("categories", sync_categories, daily=True),
        Job("products", sync_products, daily=True, after="categories"),
        Job("stock", sync_stock, every=timedelta(minutes=max(6, s.stock_sync_interval_min)), after="products"),
        Job("image_lists", sync_image_lists, every=timedelta(minutes=2), after="products"),
    ]


def is_due(job: Job, st: JobState | None, now: datetime, states: dict[str, JobState], started_here: set[str] = frozenset()) -> bool:
    s = get_settings()
    if job.after and not (states.get(job.after) and states[job.after].last_success_at):
        return False
    if st is None or st.last_started_at is None:
        return True
    # started by a previous worker process that was stopped before the job finished
    interrupted = (st.last_finished_at is None or st.last_finished_at < st.last_started_at) and job.name not in started_here
    if interrupted:
        return True
    failed = st.last_success_at is None or st.last_success_at < st.last_started_at
    if failed:
        return now - st.last_started_at >= RETRY_AFTER
    if job.daily:
        tz = ZoneInfo(s.timezone)
        local_now, last = now.astimezone(tz), st.last_success_at.astimezone(tz)
        today_slot = local_now.replace(hour=s.catalog_sync_hour, minute=0, second=0, microsecond=0)
        return local_now >= today_slot > last
    return now - st.last_started_at >= job.every


async def run_job(job: Job, client: SupplierClient) -> None:
    async with SessionLocal() as session:
        st = await session.get(JobState, job.name) or JobState(name=job.name, info={})
        st.last_started_at = utcnow()
        session.add(st)
        await session.commit()
    log.info("job %s: started", job.name)
    try:
        info = await job.run(client)
        error = None
    except Exception as e:  # noqa: BLE001 - keep the worker alive, record the error
        log.exception("job %s failed", job.name)
        info, error = None, "".join(traceback.format_exception_only(e)).strip()[:2000]
    async with SessionLocal() as session:
        st = await session.get(JobState, job.name)
        st.last_finished_at = utcnow()
        st.last_error = error
        if error is None:
            st.last_success_at = st.last_finished_at
            st.info = info or {}
        await session.commit()
    log.info("job %s: %s %s", job.name, "failed" if error else "done", info or error)


async def scheduler(client: SupplierClient, stop: asyncio.Event) -> None:
    all_jobs = jobs()
    started_here: set[str] = set()
    while not stop.is_set():
        async with SessionLocal() as session:
            states = {j.name: await session.get(JobState, j.name) for j in all_jobs}
        now = utcnow()
        for job in all_jobs:
            if stop.is_set():
                break
            if is_due(job, states[job.name], now, states, started_here):
                started_here.add(job.name)
                await run_job(job, client)
                async with SessionLocal() as session:
                    states[job.name] = await session.get(JobState, job.name)
        try:
            await asyncio.wait_for(stop.wait(), timeout=30)
        except TimeoutError:
            pass


async def image_loop(client: SupplierClient, pool: ProcessPoolExecutor, stop: asyncio.Event) -> None:
    s = get_settings()
    while not stop.is_set():
        batch = await next_pending(60, include_out_of_stock=s.image_prefetch_out_of_stock, gallery=s.image_prefetch_gallery)
        if not batch:
            try:
                await asyncio.wait_for(stop.wait(), timeout=30)
            except TimeoutError:
                pass
            continue
        # downloads are paced by the client's rate limiter, CPU work goes to the pool
        results = await asyncio.gather(*(process_one(client, pool, iid, url) for iid, url in batch), return_exceptions=True)
        done = sum(r is True for r in results)
        unavailable = sum(isinstance(r, SupplierUnavailable) for r in results)
        for r in results:
            if isinstance(r, BaseException) and not isinstance(r, SupplierUnavailable):
                log.error("image processing crashed", exc_info=r)
        log.info("images: %d processed, %d failed, %d postponed (supplier unreachable)", done, len(results) - done - unavailable, unavailable)
        if unavailable:
            try:
                await asyncio.wait_for(stop.wait(), timeout=60)  # give the supplier a break
            except TimeoutError:
                pass


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    s.media_root.mkdir(parents=True, exist_ok=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows
            pass
    async with SupplierClient(s) as client:
        if not client.has_credentials:
            log.warning("SUPPLIER_LOGIN/SUPPLIER_PASSWORD are empty: price/stock/image syncs will fail")
        with ProcessPoolExecutor(max_workers=s.image_workers) as pool:
            await asyncio.gather(scheduler(client, stop), image_loop(client, pool, stop))


if __name__ == "__main__":
    asyncio.run(main())
