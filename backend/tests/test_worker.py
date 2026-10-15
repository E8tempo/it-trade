from datetime import UTC, datetime, timedelta

from app.models import JobState
from app.worker import RETRY, Job, is_due

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)  # 15:00 in Simferopol


async def _noop(_):
    return {}


def state(started=None, finished=None, success=None) -> JobState:
    return JobState(name="x", last_started_at=started, last_finished_at=finished, last_success_at=success, info={})


def test_interval_job():
    job = Job("stock", _noop, every=timedelta(minutes=30))
    assert is_due(job, None, NOW, {})
    done = state(NOW - timedelta(minutes=10), NOW - timedelta(minutes=9), NOW - timedelta(minutes=9))
    assert not is_due(job, done, NOW, {})
    old = state(NOW - timedelta(minutes=31), NOW - timedelta(minutes=30), NOW - timedelta(minutes=30))
    assert is_due(job, old, NOW, {})


def test_failed_job_is_retried_after_a_pause():
    job = Job("stock", _noop, every=timedelta(minutes=30))
    failed = state(NOW - timedelta(minutes=5), NOW - timedelta(minutes=4), NOW - timedelta(hours=2))
    assert not is_due(job, failed, NOW, {}, started_here={"stock"})
    assert is_due(job, failed, NOW + timedelta(minutes=6), {}, started_here={"stock"})


def test_failed_job_is_retried_at_once_after_a_restart_or_when_asked():
    job = Job("stock", _noop, every=timedelta(minutes=30))
    failed = state(NOW - timedelta(minutes=5), NOW - timedelta(minutes=4), NOW - timedelta(hours=2))
    # failed in a previous worker process: the cause (e.g. the password in .env) may be fixed by now
    assert is_due(job, failed, NOW, {})
    # failed here, but the admin panel asked to retry
    failed.info = {RETRY: True}
    assert is_due(job, failed, NOW, {}, started_here={"stock"})


def test_job_interrupted_by_a_restart_runs_again_at_once():
    job = Job("image_lists", _noop, every=timedelta(hours=1))
    killed = state(started=NOW - timedelta(minutes=1), finished=NOW - timedelta(hours=1), success=NOW - timedelta(hours=1))
    assert is_due(job, killed, NOW, {})
    # ...but not the one this process is running itself
    assert not is_due(job, killed, NOW, {}, started_here={"image_lists"})


def test_daily_job_and_dependencies():
    job = Job("products", _noop, daily=True, after="categories")
    assert not is_due(job, None, NOW, {})  # categories never succeeded
    deps = {"categories": state(NOW, NOW, NOW)}
    assert is_due(job, None, NOW, deps)
    today = state(NOW - timedelta(hours=1), NOW - timedelta(hours=1), NOW - timedelta(hours=1))  # after 05:00 local
    assert not is_due(job, today, NOW, deps)
    yesterday = state(NOW - timedelta(days=1), NOW - timedelta(days=1), NOW - timedelta(days=1))
    assert is_due(job, yesterday, NOW, deps)
