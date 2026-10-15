"""A fingerprint of the backend code, so the admin panel can tell a worker started before the code changed."""

import time
from pathlib import Path

_ROOT = Path(__file__).parent
_cached: tuple[float, str] | None = None


def code_fingerprint(max_age: float = 10.0) -> str:
    """The newest modification time of the backend's .py files. Equal in the API and the worker that run the
    same code (in docker both come from one image); the worker's is taken when it starts."""
    global _cached
    now = time.monotonic()
    if _cached is None or now - _cached[0] > max_age:
        newest = max(p.stat().st_mtime for p in _ROOT.rglob("*.py"))
        _cached = (now, f"{newest:.0f}")
    return _cached[1]
