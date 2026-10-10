"""CPU part of the image pipeline: decode -> remove watermark -> resize -> WebP.

Runs in a process pool (`process_image` only takes/returns plain data).
"""

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from PIL.JpegImagePlugin import get_sampling

from app.images.watermark import default_remover

# Longest side of the generated variants: product page / listing card (2x for retina) / cart & search.
SIZES = {"lg": 1000, "md": 480, "sm": 160}
WEBP_QUALITY = 82
_SUBSAMPLING = {0: (1, 1), 1: (2, 1), 2: (2, 2)}
T = Image.Transpose
_EXIF_TRANSPOSE = {2: T.FLIP_LEFT_RIGHT, 3: T.ROTATE_180, 4: T.FLIP_TOP_BOTTOM, 5: T.TRANSPOSE,
                   6: T.ROTATE_270, 7: T.TRANSVERSE, 8: T.ROTATE_90}


@dataclass
class ProcessedImage:
    width: int
    height: int
    wm_template: str | None
    wm_score: float | None


def image_path(media_root: Path, image_id: int, size: str) -> Path:
    return media_root / "products" / f"{image_id % 1000:03d}" / f"{image_id}_{size}.webp"


def image_url(media_url: str, image_id: int, size: str, version: int = 1) -> str:
    return f"{media_url}/products/{image_id % 1000:03d}/{image_id}_{size}.webp?v={version}"


def _flatten(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        return bg
    return im.convert("RGB")


def process_image(data: bytes, media_root: str, image_id: int) -> ProcessedImage:
    """Removes the watermark from a supplier image and writes all WebP sizes atomically."""
    im = Image.open(io.BytesIO(data))
    sub = _SUBSAMPLING.get(get_sampling(im), (2, 2)) if im.format == "JPEG" else (1, 1)
    im.load()
    # The supplier draws the watermark on the stored pixels, so no EXIF rotation before removal.
    rgb = np.asarray(_flatten(im))
    clean, det = default_remover().remove(rgb, chroma_subsampling=sub)

    out = Image.fromarray(clean)
    if transpose := _EXIF_TRANSPOSE.get(im.getexif().get(0x0112, 1)):
        out = out.transpose(transpose)
    root = Path(media_root)
    for size, side in SIZES.items():
        variant = out.copy()
        if max(variant.size) > side:
            variant.thumbnail((side, side), Image.Resampling.LANCZOS)
        dest = image_path(root, image_id, size)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        variant.save(tmp, "WEBP", quality=WEBP_QUALITY, method=4)
        tmp.replace(dest)
    return ProcessedImage(
        width=out.width,
        height=out.height,
        wm_template=(det.template + ("-rot" if det.rotated else "")) if det else None,
        wm_score=round(det.score, 4) if det else None,
    )


def delete_image_files(media_root: Path, image_id: int) -> None:
    for size in SIZES:
        image_path(media_root, image_id, size).unlink(missing_ok=True)
