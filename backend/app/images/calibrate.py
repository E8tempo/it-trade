"""Estimate watermark alpha mattes from a folder of watermarked supplier images.

Used to (re)build the templates, e.g. if the supplier changes its watermark:

    python -m app.cli watermark-sample ./samples 3000     # random supplier originals
    python -m app.cli watermark-calibrate ./samples

Where the background B under a watermark pixel is smooth and bright, J = a*W + (1 - a)*B gives
a = (B - J) / (B - W) directly. Per variant, every image whose watermark the current templates
find (single grey layer, inside the image) is aligned at its detected integer offset, B is
inpainted from the pixels around the strokes, and per template pixel the estimates of all images
are combined into a weighted mean, weight ((B - W) / (255 - W))^2: a white background counts 1.
A second pass repeats the mean without the estimates further than 2.5 spreads from the first one
(the edge of a product, a highlight). Pixels with too little evidence keep the current value.

The letters also have a thin near-black outline, which over a white background looks like denser grey and
so ends up in these alphas. It shows over dark backgrounds only, so the layer model is calibrated separately
(`layer_curve`): pixels of the same template alpha are pooled over all images, with backgrounds of any
brightness, and J = t*B + h is fitted per alpha bin. The result t(a) and c(a) = h / W is stored with the
templates (see watermark.CURVE_KEYS).
"""

import logging
from collections.abc import Iterable, Iterator
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app.images.watermark import (
    CURVE_KEYS,
    VARIANTS,
    Curve,
    Detection,
    WatermarkRemover,
    calibrated_file,
    default_remover,
    luma,
)

log = logging.getLogger(__name__)
MARGIN = 6
MIN_IMAGES = 20  # fewer images of a variant: keep its current template
MIN_WEIGHT = 3.0  # "white-background equivalents" a pixel needs to be re-estimated
BRIGHT = 170  # minimal background luma: the darker, the noisier (B - J) / (B - W)
SMOOTH_STD = 3.0  # maximal spread of the surroundings, luma levels
WINDOW = 15
OUTLIER_SPREADS = 2.5
COLOUR_TOLERANCE = 8.0  # single grey layer only: darker / stacked marks would distort the shape
CURVE_STEP = 0.01  # alpha bin of the layer curve
CURVE_MIN_WEIGHT = 2000  # pixels a bin needs
CURVE_MIN_SPREAD = 40.0  # luma spread of the backgrounds a bin needs, darker and lighter ones both


def _rgb(path: Path) -> np.ndarray | None:
    try:
        return np.asarray(Image.open(path).convert("RGB"))
    except Exception:  # noqa: BLE001 - broken downloads are just skipped
        return None


def detections(rm: WatermarkRemover, files: Iterable[Path]) -> dict[str, list[tuple[Path, Detection]]]:
    """Files per variant whose watermark lies fully inside the image (rotated ones are skipped)."""
    out: dict[str, list[tuple[Path, Detection]]] = {t.name: [] for t in rm.templates}
    for f in files:
        rgb = _rgb(f)
        if rgb is None:
            continue
        det = rm.detect(rgb)
        if det is None or det.rotated:
            continue
        th, tw = rm.template(det.template).alpha.shape
        if det.x < MARGIN or det.y < MARGIN or det.y + th + MARGIN > rgb.shape[0] or det.x + tw + MARGIN > rgb.shape[1]:
            continue
        out[det.template].append((f, det))
    return out


def estimates(rm: WatermarkRemover, rgb: np.ndarray, det: Detection) -> tuple[np.ndarray, np.ndarray] | None:
    """Alpha estimate and its weight per pixel of the template padded by MARGIN, None if the image is unusable."""
    _, removed = rm.remove(rgb, det)
    if removed is None or removed.layers != 1 or abs((removed.color or 0) - rm.color) > COLOUR_TOLERANCE:
        return None
    if removed.dx or removed.dy:  # resampled after watermarking: the strokes are blurred
        return None
    t = rm.template(det.template).alpha
    th, tw = t.shape
    x, y = removed.x, removed.y  # the removal may have moved the detection by a pixel
    if x < MARGIN or y < MARGIN or y + th + MARGIN > rgb.shape[0] or x + tw + MARGIN > rgb.shape[1]:
        return None
    J = luma(rgb[y - MARGIN : y + th + MARGIN, x - MARGIN : x + tw + MARGIN])
    strokes = np.pad(cv2.dilate((t > 0.005).astype(np.uint8), np.ones((5, 5), np.uint8)), MARGIN)
    B = cv2.inpaint(J, strokes, 3, cv2.INPAINT_TELEA)
    clean = (strokes == 0).astype(np.float32)
    n = cv2.boxFilter(clean, -1, (WINDOW, WINDOW), normalize=False)
    s1 = cv2.boxFilter(J * clean, -1, (WINDOW, WINDOW), normalize=False)
    s2 = cv2.boxFilter(J * J * clean, -1, (WINDOW, WINDOW), normalize=False)
    with np.errstate(all="ignore"):
        mean = s1 / n
        std = np.sqrt(np.maximum(s2 / n - mean * mean, 0))
    usable = (n >= WINDOW) & (std <= SMOOTH_STD) & (B > BRIGHT)
    contrast = B - rm.color
    alpha = np.where(usable, (B - J) / np.maximum(contrast, 1), 0).astype(np.float32)
    weight = np.where(usable, (contrast / (255 - rm.color)) ** 2, 0).astype(np.float32)
    return alpha, weight


def _each(rm: WatermarkRemover, items: list[tuple[Path, Detection]]) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    for f, det in items:
        rgb = _rgb(f)
        if rgb is not None and (e := estimates(rm, rgb, det)) is not None:
            yield e


def estimate(rm: WatermarkRemover, items: list[tuple[Path, Detection]], current: np.ndarray) -> tuple[np.ndarray, int, float]:
    """(new alpha, images used, share of the strokes re-estimated) for one variant."""
    shape = (current.shape[0] + 2 * MARGIN, current.shape[1] + 2 * MARGIN)
    sw, swa, swa2 = np.zeros(shape), np.zeros(shape), np.zeros(shape)
    used = 0
    for a, w in _each(rm, items):
        sw += w
        swa += w * a
        swa2 += w * a * a
        used += 1
    with np.errstate(all="ignore"):
        mean = swa / sw
        spread = np.maximum(np.sqrt(np.maximum(swa2 / sw - mean * mean, 0)), 0.01)
    sw2, swa2_ = np.zeros(shape), np.zeros(shape)
    for a, w in _each(rm, items):
        keep = w * (np.abs(a - mean) <= OUTLIER_SPREADS * spread)
        sw2 += keep
        swa2_ += keep * a
    old = np.pad(current, MARGIN)
    support = cv2.dilate((old > 0.005).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ok = (sw2 >= MIN_WEIGHT) & support
    with np.errstate(all="ignore"):
        new = np.where(ok, np.clip(swa2_ / sw2, 0, 0.98), old)
    new[~support] = 0
    new[new < 0.006] = 0
    strokes = old > 0.01
    covered = float(ok[strokes].mean()) if strokes.any() else 0.0
    return new[MARGIN:-MARGIN, MARGIN:-MARGIN].astype(np.float32), used, covered


def _background(rm: WatermarkRemover, rgb: np.ndarray, det: Detection) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """(J, B, alpha) of the pixels whose surroundings are smooth, of a single grey layer, None if unusable."""
    _, removed = rm.remove(rgb, det)
    if removed is None or removed.layers != 1 or removed.opacity != 1.0 or removed.dx or removed.dy:
        return None
    if abs((removed.color or 0) - rm.color) > COLOUR_TOLERANCE:
        return None
    t = rm.template(det.template).alpha
    th, tw = t.shape
    x, y = removed.x, removed.y
    if x < MARGIN or y < MARGIN or y + th + MARGIN > rgb.shape[0] or x + tw + MARGIN > rgb.shape[1]:
        return None
    J = luma(rgb[y - MARGIN : y + th + MARGIN, x - MARGIN : x + tw + MARGIN])
    a = np.pad(t, MARGIN)
    strokes = cv2.dilate((a > 0.002).astype(np.uint8), np.ones((3, 3), np.uint8))
    B = cv2.inpaint(np.clip(J, 0, 255).astype(np.uint8), strokes, 4, cv2.INPAINT_TELEA).astype(np.float32)
    clean = (strokes == 0).astype(np.float32)
    n = cv2.boxFilter(clean, -1, (WINDOW, WINDOW), normalize=False)
    s1 = cv2.boxFilter(J * clean, -1, (WINDOW, WINDOW), normalize=False)
    s2 = cv2.boxFilter(J * J * clean, -1, (WINDOW, WINDOW), normalize=False)
    with np.errstate(all="ignore"):
        mean = s1 / n
        std = np.sqrt(np.maximum(s2 / n - mean * mean, 0))
    usable = (n >= 3 * WINDOW) & (std <= SMOOTH_STD - 0.5) & (B < 250) & (J < 252) & (a > 0)
    return J[usable], B[usable], a[usable]


def layer_curve(rm: WatermarkRemover, groups: dict[str, list[tuple[Path, Detection]]]) -> Curve:
    """t(a), c(a) of one layer pooled over all variants, None without enough dark and light backgrounds."""
    a_max = max(float(t.alpha.max()) for t in rm.templates)
    bins = int(np.ceil(a_max / CURVE_STEP))
    sums = np.zeros((6, bins))  # n, B, J, BB, BJ, a
    for items in groups.values():
        for f, det in items:
            rgb = _rgb(f)
            if rgb is None or (got := _background(rm, rgb, det)) is None:
                continue
            J, B, a = (v.astype(np.float64) for v in got)
            k = np.minimum((a / CURVE_STEP).astype(int), bins - 1)
            for i, v in enumerate((np.ones_like(a), B, J, B * B, B * J, a)):
                sums[i] += np.bincount(k, v, bins)
    n, sB, sJ, sBB, sBJ, sa = sums
    with np.errstate(all="ignore"):
        var = sBB / n - (sB / n) ** 2
        t = (sBJ / n - (sB / n) * (sJ / n)) / var
        h = sJ / n - t * sB / n
    ok = (n >= CURVE_MIN_WEIGHT) & (np.sqrt(np.maximum(var, 0)) >= CURVE_MIN_SPREAD)
    if ok.sum() < 0.8 * bins:
        return None
    a_c = np.concatenate([[0.0], sa[ok] / n[ok]])
    t_c = np.concatenate([[1.0], t[ok]])
    c_c = np.concatenate([[0.0], h[ok] / rm.color])
    for v in (t_c, c_c):  # light smoothing of the bin noise
        v[1:-1] = (v[:-2] + v[1:-1] + v[2:]) / 3
    return a_c.astype(np.float32), t_c.astype(np.float32), np.maximum(c_c, 0).astype(np.float32)


def calibrate(folder: Path, out: Path | None = None, rm: WatermarkRemover | None = None) -> dict[str, int]:
    """Writes the templates to the media volume (picked up after a restart of api/worker)."""
    out = out or calibrated_file()
    out.parent.mkdir(parents=True, exist_ok=True)
    rm = rm or default_remover()
    groups = detections(rm, sorted(folder.glob("*.jpg")))
    alphas, used = {}, {}
    for name in VARIANTS:
        current = rm.template(name).alpha
        items = groups.get(name, [])
        if len(items) < MIN_IMAGES:
            log.warning("%s: only %d images, keeping the current template", name, len(items))
            alphas[name], used[name] = current, 0
            continue
        alpha, used[name], covered = estimate(rm, items, current)
        if used[name] < MIN_IMAGES:
            log.warning("%s: only %d usable images, keeping the current template", name, used[name])
            alpha = current
        else:
            log.info("%s: %d images, %.0f%% of the strokes re-estimated", name, used[name], covered * 100)
        alphas[name] = alpha
    curve = layer_curve(rm, groups)
    if curve is None:
        log.warning("layer curve: too few dark and light backgrounds, keeping the current one")
        curve = rm.curve
    extra = dict(zip(CURVE_KEYS, curve, strict=True)) if curve is not None else {}
    np.savez_compressed(out, **alphas, W=np.float32(rm.color), **extra)
    return used
