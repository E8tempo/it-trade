"""Which of a product's photos the storefront shows.

Supplier galleries carry junk: the same set uploaded twice in two sizes, marketing slides repeated
in six languages, small images (300 x 300). After a photo is processed, the product's photos are
compared on CELLS x CELLS colour thumbnails of the stored files, and every copy of a photo gets
`duplicate_of` = the largest copy. The product page shows that one at the place of the first copy
and drops secondary photos smaller than the shop setting.
"""

from collections.abc import Sequence
from typing import Protocol

import numpy as np
from PIL import Image

CELLS = 16  # thumbnail side
CELL_TOLERANCE = 12.0  # levels a cell of a copy may differ by (compression, resampling)
WHITE = 235  # a cell this light in every channel is background
# A copy (the same photo uploaded again in another size): the aspect ratio within 1% (measured
# <= 0.15%) and at least 95% of the cells that are not background in both photos alike (measured
# 100%). Counting only those cells matters: photos of a thin product on white are 90% background,
# and the jack stand at another height or a black rod instead of a white one matched 13..52% and 0%.
COPY_SHARE, COPY_ASPECT = 0.95, 0.01
# A marketing slide repeated in another language: the same size, and only the text band at the top
# differs (rows 1..4 of 16 on the dev galleries). Only for designed slides, at least half of the
# cells below the band not background: on white, other angles of a product differ in a band too.
TEXT_ROWS, SLIDE_CONTENT = 5, 0.5


class Photo(Protocol):
    id: int
    width: int | None
    height: int | None
    duplicate_of: int | None


def thumbnail(im: Image.Image) -> np.ndarray:
    """Mean colours of CELLS x CELLS cells of the photo: what copies are compared by."""
    return np.asarray(im.convert("RGB").resize((CELLS, CELLS), Image.Resampling.BOX), np.float32)


def copies(photos: Sequence[tuple[Photo, np.ndarray]]) -> dict[int, int | None]:
    """Photo id -> id of the copy shown instead of it, None for the photo shown itself: the
    largest of each group of copies, the first of equally large ones. `photos` is in order."""
    groups: list[list[tuple[Photo, np.ndarray]]] = []
    for item in photos:
        group = next((g for g in groups if _alike(g[0], item)), None)
        if group is None:
            groups.append([item])
        else:
            group.append(item)
    result: dict[int, int | None] = {}
    for group in groups:
        kept = max((p for p, _ in group), key=lambda p: (p.width or 0) * (p.height or 0))
        result.update({p.id: None if p is kept else kept.id for p, _ in group})
    return result


def _alike(a: tuple[Photo, np.ndarray], b: tuple[Photo, np.ndarray]) -> bool:
    (pa, ta), (pb, tb) = a, b
    if not (pa.width and pa.height and pb.width and pb.height):
        return False
    ra, rb = pa.width / pa.height, pb.width / pb.height
    if abs(ra - rb) > COPY_ASPECT * max(ra, rb):
        return False
    same = np.abs(ta - tb).max(axis=-1) < CELL_TOLERANCE
    content = (ta.min(axis=-1) < WHITE) | (tb.min(axis=-1) < WHITE)
    if not content.any() or same[content].mean() >= COPY_SHARE:
        return True
    return (
        (pa.width, pa.height) == (pb.width, pb.height)
        and bool(same[TEXT_ROWS:].all())
        and content[TEXT_ROWS:].mean() >= SLIDE_CONTENT
    )


def gallery[P: Photo](photos: Sequence[P], min_side: int, dedupe: bool = True) -> list[P]:
    """The photos to show, in order. The first photo always stays, maybe as a larger copy of it;
    photos not processed yet have no size and are kept."""
    shown = list(photos)
    if dedupe:
        by_id = {p.id: p for p in photos}
        seen: set[int] = set()
        shown = []
        for p in photos:
            kept = by_id.get(p.duplicate_of, p) if p.duplicate_of is not None else p
            if kept.id not in seen:
                seen.add(kept.id)
                shown.append(kept)
    return [p for k, p in enumerate(shown) if k == 0 or not _small(p, min_side)]


def _small(p: Photo, min_side: int) -> bool:
    return p.width is not None and p.height is not None and max(p.width, p.height) < min_side
