from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.models import JobState
from app.site_settings import SyncSettings
from app.worker import RETRY, Job, catalog_slot, is_due, scheduled_at

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)  # 15:00 in Simferopol


async def _noop(_):
    return {}


def state(started=None, finished=None, success=None) -> JobState:
    return JobState(name="x", last_started_at=started, last_finished_at=finished, last_success_at=success, info={})


def test_interval_job():
    job = Job("stock", _noop, every=lambda c: timedelta(minutes=c.stock_every_min))
    assert is_due(job, None, NOW, {})
    done = state(NOW - timedelta(minutes=10), NOW - timedelta(minutes=9), NOW - timedelta(minutes=9))
    assert not is_due(job, done, NOW, {})
    old = state(NOW - timedelta(minutes=31), NOW - timedelta(minutes=30), NOW - timedelta(minutes=30))
    assert is_due(job, old, NOW, {})


def test_failed_job_is_retried_after_a_pause():
    job = Job("stock", _noop, every=lambda c: timedelta(minutes=c.stock_every_min))
    failed = state(NOW - timedelta(minutes=5), NOW - timedelta(minutes=4), NOW - timedelta(hours=2))
    assert not is_due(job, failed, NOW, {}, started_here={"stock"})
    assert is_due(job, failed, NOW + timedelta(minutes=6), {}, started_here={"stock"})


def test_failed_job_is_retried_at_once_after_a_restart_or_when_asked():
    job = Job("stock", _noop, every=lambda c: timedelta(minutes=c.stock_every_min))
    failed = state(NOW - timedelta(minutes=5), NOW - timedelta(minutes=4), NOW - timedelta(hours=2))
    # failed in a previous worker process: the cause (e.g. the password in .env) may be fixed by now
    assert is_due(job, failed, NOW, {})
    # failed here, but the admin panel asked to retry
    failed.info = {RETRY: True}
    assert is_due(job, failed, NOW, {}, started_here={"stock"})


def test_job_interrupted_by_a_restart_runs_again_at_once():
    job = Job("image_lists", _noop, every=lambda c: timedelta(hours=1))
    killed = state(started=NOW - timedelta(minutes=1), finished=NOW - timedelta(hours=1), success=NOW - timedelta(hours=1))
    assert is_due(job, killed, NOW, {})
    # ...but not the one this process is running itself
    assert not is_due(job, killed, NOW, {}, started_here={"image_lists"})


def test_daily_job_and_dependencies():
    job = Job("products", _noop, catalog=True, after="categories")
    assert not is_due(job, None, NOW, {})  # categories never succeeded
    deps = {"categories": state(NOW, NOW, NOW)}
    assert is_due(job, None, NOW, deps)
    today = state(NOW - timedelta(hours=1), NOW - timedelta(hours=1), NOW - timedelta(hours=1))  # after 05:00 local
    assert not is_due(job, today, NOW, deps)
    yesterday = state(NOW - timedelta(days=1), NOW - timedelta(days=1), NOW - timedelta(days=1))
    assert is_due(job, yesterday, NOW, deps)


def test_stock_interval_comes_from_the_settings():
    job = Job("stock", _noop, every=lambda c: timedelta(minutes=c.stock_every_min))
    ran = state(NOW - timedelta(minutes=20), NOW - timedelta(minutes=19), NOW - timedelta(minutes=19))
    assert not is_due(job, ran, NOW, {}, cfg=SyncSettings(stock_every_min=30))
    assert is_due(job, ran, NOW, {}, cfg=SyncSettings(stock_every_min=15))
    assert scheduled_at(job, ran, NOW, SyncSettings(stock_every_min=30)) == NOW + timedelta(minutes=10)


def test_catalog_slots_every_few_hours():
    cfg = SyncSettings(catalog_every_hours=6, catalog_hour=5)  # 05:00, 11:00, 17:00, 23:00 local (UTC+3)
    assert catalog_slot(NOW, cfg) == datetime(2026, 10, 10, 8, 0, tzinfo=UTC)  # 15:00 local -> 11:00
    early = datetime(2026, 10, 10, 0, 0, tzinfo=UTC)  # 03:00 local -> 23:00 the day before
    assert catalog_slot(early, cfg) == datetime(2026, 10, 9, 20, 0, tzinfo=UTC)
    job = Job("products", _noop, catalog=True)
    before_slot = state(NOW - timedelta(hours=5), NOW - timedelta(hours=5), NOW - timedelta(hours=5))  # 10:00 local
    assert is_due(job, before_slot, NOW, {}, cfg=cfg)
    after_slot = state(NOW - timedelta(hours=3), NOW - timedelta(hours=3), NOW - timedelta(hours=3))  # 12:00 local
    assert not is_due(job, after_slot, NOW, {}, cfg=cfg)
    assert scheduled_at(job, after_slot, NOW, cfg) == datetime(2026, 10, 10, 14, 0, tzinfo=UTC)  # 17:00 local


def test_catalog_interval_must_divide_a_day():
    with pytest.raises(ValidationError):
        SyncSettings(catalog_every_hours=5)
