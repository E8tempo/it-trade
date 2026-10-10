"""Product image files.

In production Caddy serves existing files from MEDIA_ROOT directly and only forwards misses
here; this handler then downloads the image from the supplier, removes the watermark and
stores all sizes (so the worker can skip it). In development it serves files too.
"""

import asyncio
import re
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.config import get_settings
from app.db import SessionLocal
from app.images.processing import SIZES, image_path
from app.models import ProductImage
from app.models.catalog import ImageStatus
from app.sync.images import process_one

router = APIRouter(tags=["media"])
_NAME = re.compile(r"(\d+)_([a-z]+)\.webp")
_locks: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
CACHE = {"Cache-Control": "public, max-age=31536000, immutable"}


@router.get("/media/products/{shard}/{name}", include_in_schema=False)
async def product_image(shard: str, name: str, request: Request):
    m = _NAME.fullmatch(name)
    if not m or m.group(2) not in SIZES:
        raise HTTPException(404)
    image_id, size = int(m.group(1)), m.group(2)
    if shard != f"{image_id % 1000:03d}":
        raise HTTPException(404)
    s = get_settings()
    path = image_path(s.media_root, image_id, size)
    if not path.exists():
        async with SessionLocal() as session:
            img = await session.get(ProductImage, image_id)
        if img is None or img.status == ImageStatus.failed:
            raise HTTPException(404)
        lock = _locks[image_id]
        async with lock:
            if not path.exists():
                ok = await process_one(request.app.state.ondemand_client, None, image_id, img.source_url)
                if not ok:
                    raise HTTPException(503, headers={"Retry-After": "60"})
        _locks.pop(image_id, None)
    return FileResponse(path, media_type="image/webp", headers=CACHE)
