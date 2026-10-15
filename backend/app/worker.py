"""Background worker: periodic supplier syncs and housekeeping + continuous image processing.

    python -m app.worker
"""

import asyncio
import logging
import os
import signal
import statistics
import time
import traceback
from collections.abc import Awaitable, Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.db import SessionLocal
from app.images.processing import ProcessedImage
from app.models import JobState
from app.models.base import utcnow
from app.site_settings import ImageSettings, get_settings_obj
from app.supplier.client import SupplierClient, SupplierUnavailable
from app.sync.categories import sync_categories
from app.sync.images import next_pending, pick_trial, process_one, sync_image_lists
from app.sync.products import sync_products
from app.sync.stock import sync_stock

log = logging.getLogger("worker")
RETRY_AFTER = timedelta(minutes=10)
RETRY = "retry"  # info flag of a failed job: run it again at once (the "Повторить сейчас" button)
# job_state rows that are not jobs: the worker's heartbeat and the trial batch asked for in the admin panel
WORKER, TRIAL = "worker", "trial"
HEARTBEAT_EVERY = 30  # seconds; the admin panel calls the worker stopped after a few missed ones
IDLE_WAIT = 10  # seconds between looks at the settings and the trial while there is no work
# An empty queue is looked at again after this long (~1 s of database work on the whole catalog), or
# at once after a supplier sync or a change of the settings: those are what bring new work.
EMPTY_QUEUE_WAIT = 60


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
        # at once when asked from the admin panel, or by a new worker process: it is usually restarted after
        # the cause was fixed (e.g. the supplier's password in .env, which is read at start); else after a pause
        if st.info.get(RETRY) or job.name not in started_here:
            return True
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
        st.info = {k: v for k, v in (st.info or {}).items() if k != RETRY}
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


async def scheduler(client: SupplierClient, stop: asyncio.Event, state: dict) -> None:
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
                state["queue_changed"] = True  # new products, photo lists or stock: maybe new photos
                async with SessionLocal() as session:
                    states[job.name] = await session.get(JobState, job.name)
        try:
            await asyncio.wait_for(stop.wait(), timeout=30)
        except TimeoutError:
            pass


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        pass


async def image_loop(client: SupplierClient, pool: ProcessPoolExecutor, stop: asyncio.Event, state: dict) -> None:
    s = get_settings()
    last_cfg, next_look = None, 0.0  # when to look at the queue again
    while not stop.is_set():
        async with SessionLocal() as session:
            cfg = await get_settings_obj(session, ImageSettings)
        client.set_image_rps(cfg.download_rps)
        state.update(paused=cfg.paused, download_rps=cfg.download_rps)
        if cfg != last_cfg or state.pop("queue_changed", False):
            last_cfg, next_look = cfg, 0.0
        if await run_trial(client, pool, state):
            continue
        batch = []
        if not cfg.paused and time.monotonic() >= next_look:
            batch = await next_pending(60, cfg, include_out_of_stock=s.image_prefetch_out_of_stock)
            if not batch:
                next_look = time.monotonic() + EMPTY_QUEUE_WAIT
        state["activity"] = "photos" if batch else "paused" if cfg.paused else "idle"
        if not batch:
            await _sleep(stop, IDLE_WAIT)
            continue
        # downloads are paced by the client's rate limiter, CPU work goes to the pool
        results = await asyncio.gather(*(process_one(client, pool, iid, url) for iid, url in batch), return_exceptions=True)
        done = sum(isinstance(r, ProcessedImage) for r in results)
        unavailable = sum(isinstance(r, SupplierUnavailable) for r in results)
        for r in results:
            if isinstance(r, BaseException) and not isinstance(r, SupplierUnavailable):
                log.error("image processing crashed", exc_info=r)
        log.info("images: %d processed, %d failed, %d postponed (supplier unreachable)", done, len(results) - done - unavailable, unavailable)
        if unavailable:
            await _sleep(stop, 60)  # give the supplier a break


async def run_trial(client: SupplierClient, pool: ProcessPoolExecutor, state: dict) -> bool:
    """Processes the trial batch asked for in the admin panel, if there is one: random main photos of
    in-stock products, with the speed and the CPU time measured. Returns whether there was one."""
    async with SessionLocal() as session:
        st = await session.get(JobState, TRIAL)
        if st is None or st.info.get("status") != "queued":
            return False
        photos = await pick_trial(int(st.info.get("requested") or 0))
        st.last_started_at = utcnow()
        st.last_error = None
        st.info = {**st.info, "status": "running", "ids": [iid for iid, _ in photos], "count": len(photos), "done": 0, "failed": 0}
        await session.commit()
    log.info("trial batch: %d photos", len(photos))
    state["activity"] = "trial"
    started, times, failed = time.monotonic(), [], 0
    # all at once, as the queue would: downloads paced by the rate limiter keep the pool busy
    tasks = [asyncio.ensure_future(process_one(client, pool, iid, url)) for iid, url in photos]
    for k, task in enumerate(asyncio.as_completed(tasks), 1):
        try:
            res = await task
        except Exception:  # noqa: BLE001 - counted as failed: network trouble or a crash
            log.exception("trial photo failed")
            res = None
        if isinstance(res, ProcessedImage):
            times.append(res.ms)
        else:
            failed += 1
        if k % 10 == 0 or k == len(tasks):
            async with SessionLocal() as session:
                st = await session.get(JobState, TRIAL)
                st.info = {**st.info, "done": len(times), "failed": failed}
                await session.commit()
    elapsed = time.monotonic() - started
    async with SessionLocal() as session:
        st = await session.get(JobState, TRIAL)
        st.last_finished_at = st.last_success_at = utcnow()
        st.info = {
            **st.info,
            "status": "done",
            "seconds": round(elapsed, 1),
            "ms_median": round(statistics.median(times)) if times else None,
            "download_rps": round(client.image_rps, 2),
            "image_workers": get_settings().image_workers,
        }
        await session.commit()
    log.info("trial batch: %d done, %d failed in %.0f s", len(times), failed, elapsed)
    return True


async def heartbeat(stop: asyncio.Event, state: dict) -> None:
    """Tells the admin panel that the worker runs and what it does (job_state row "worker")."""
    s = get_settings()
    started = utcnow()
    async with SessionLocal() as session:
        # a trial cut short by a restart is not resumed: a new one can be started
        trial = await session.get(JobState, TRIAL)
        if trial is not None and trial.info.get("status") == "running":
            trial.info = {**trial.info, "status": "interrupted"}
            trial.last_finished_at = started
        await session.commit()
    while not stop.is_set():
        async with SessionLocal() as session:
            st = await session.get(JobState, WORKER) or JobState(name=WORKER, info={})
            st.last_started_at = started
            st.info = {
                "heartbeat": utcnow().isoformat(),
                "pid": os.getpid(),
                "cpus": os.cpu_count(),
                "image_workers": s.image_workers,
                **{k: v for k, v in state.items() if k != "queue_changed"},
            }
            session.add(st)
            await session.commit()
        await _sleep(stop, HEARTBEAT_EVERY)


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
            state: dict = {"activity": "starting"}
            await asyncio.gather(scheduler(client, stop, state), image_loop(client, pool, stop, state), heartbeat(stop, state))


if __name__ == "__main__":
    asyncio.run(main())
