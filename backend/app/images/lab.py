"""Watermark lab of the admin panel: runs one image through detection and removal exactly like the
image pipeline does, and reports every step with previews."""

import base64
import io
from time import perf_counter

import numpy as np
from PIL import Image
from PIL.JpegImagePlugin import get_sampling

from app.images.processing import _SUBSAMPLING, _flatten
from app.images.watermark import Detection, default_remover, luma

PREVIEW_SIDE = 1200  # px, longest side of the whole-image previews
CROP_MARGIN = 16  # px around the watermark in the close-ups
CROP_MAX_WIDTH = 1000


def analyze(data: bytes) -> dict:
    im = Image.open(io.BytesIO(data))
    sub = _SUBSAMPLING.get(get_sampling(im), (2, 2)) if im.format == "JPEG" else (1, 1)
    im.load()
    rgb = np.asarray(_flatten(im))
    h, w = rgb.shape[:2]
    rm = default_remover()

    t0 = perf_counter()
    found = rm.scan(rgb)
    t_detect = perf_counter() - t0
    candidates = sorted(
        ({**_det(d), "clipped": rm.clipped_share(d, w, h), "verdict": rm.verdict(d, w, h)} for d in found),
        key=lambda c: -c["score"],
    )
    best = max(found, key=lambda d: d.score) if found else None
    det = best if best and rm.verdict(best, w, h) else None
    result: dict = {
        "width": w,
        "height": h,
        "format": im.format,
        "chroma_subsampling": f"{sub[0]}x{sub[1]}",
        "candidates": candidates,
        "detection": None,
        "timings_ms": {"detect": round(t_detect * 1000, 1)},
        "images": {"original": _data_url(_preview(rgb))},
    }
    if det is None:
        return result

    trace: dict = {}
    t0 = perf_counter()
    clean, removed = rm.remove(rgb, det, sub, trace)
    result["timings_ms"]["remove"] = round((perf_counter() - t0) * 1000, 1)
    assert removed is not None
    ax, ay, alpha = rm.alpha_region(removed, w, h)
    x0, y0 = max(0, ax - CROP_MARGIN), max(0, ay - CROP_MARGIN)
    x1, y1 = min(w, ax + alpha.shape[1] + CROP_MARGIN), min(h, ay + alpha.shape[0] + CROP_MARGIN)
    a = np.zeros((y1 - y0, x1 - x0), np.float32)
    a[ay - y0 : ay - y0 + alpha.shape[0], ax - x0 : ax - x0 + alpha.shape[1]] = alpha
    before, after = rgb[y0:y1, x0:x1], clean[y0:y1, x0:x1]

    fit = trace.get("fit") or []
    result["detection"] = {
        **_det(removed),
        "verdict": rm.verdict(det, w, h),
        "moved": trace.get("moved"),
        "box": [x0, y0, x1, y1],
        "template_size": list(rm.template(det.template).alpha.shape[::-1]),
        "strength_left": rm.residual(clean, removed),
    }
    result["plain"] = trace.get("plain", {"share": 0.0, "max": 0.0})
    result["fit"] = {
        "pixels": fit[0]["pixels"] if fit else 0,
        "fallback": trace.get("fallback", True),
        "switched": trace.get("switched"),
        "grey": rm.color,
        "candidates": [{**c, "chosen": c.get("chosen", False)} for c in fit[1:]],
    }
    result["images"].update(
        cleaned=_data_url(_preview(clean)),
        crop_before=_data_url(_fit_width(before)),
        crop_after=_data_url(_fit_width(after)),
        mask=_data_url(_fit_width(_mask_overlay(before, a))),
        diff=_data_url(_fit_width(_diff(before, after))),
    )
    return result


def _det(d: Detection) -> dict:
    return {
        "template": d.template,
        "rotated": d.rotated,
        "x": d.x,
        "y": d.y,
        "score": d.score,
        "strength": d.strength,
        "layers": d.layers,
        "color": d.color,
    }


def _preview(rgb: np.ndarray) -> np.ndarray:
    im = Image.fromarray(rgb)
    im.thumbnail((PREVIEW_SIDE, PREVIEW_SIDE), Image.Resampling.LANCZOS)
    return np.asarray(im)


def _fit_width(rgb: np.ndarray) -> np.ndarray:
    if rgb.shape[1] <= CROP_MAX_WIDTH:
        return rgb
    im = Image.fromarray(rgb)
    im.thumbnail((CROP_MAX_WIDTH, CROP_MAX_WIDTH * 10), Image.Resampling.LANCZOS)
    return np.asarray(im)


def _mask_overlay(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """The template alpha in red over the greyed-out image: where the model expects the watermark."""
    grey = luma(rgb)[..., None] * 0.6 + 100
    m = np.clip(alpha * 1.8, 0, 1)[..., None]
    red = np.array([230, 40, 40], np.float32)
    return np.clip(grey * (1 - m) + red * m, 0, 255).astype(np.uint8)


def _diff(before: np.ndarray, after: np.ndarray) -> np.ndarray:
    """|after - before| of the luma, x3: which pixels the removal changed and by how much."""
    d = np.abs(luma(after) - luma(before)) * 3
    return np.repeat(np.clip(255 - d, 0, 255).astype(np.uint8)[..., None], 3, axis=2)


def _data_url(rgb: np.ndarray, quality: int = 90) -> str:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "WEBP", quality=quality, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
