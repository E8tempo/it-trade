"""Estimate watermark alpha mattes from a folder of watermarked supplier images.

Used to (re)build `data/itp_watermark.npz`, e.g. if the supplier changes its watermark:

    python -m app.cli watermark-sample ./samples 3000     # random supplier originals
    python -m app.cli watermark-calibrate ./samples

Per variant: every image is aligned at its detected integer offset, then for each pixel the
median of the watermarked value over images whose *cleaned* neighbourhood is pure white gives
`255 - alpha * (255 - W)`. Unlike the per-pixel maximum this is not biased by JPEG noise.
"""

import logging
from collections.abc import Iterable
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app.images.watermark import VARIANTS, WatermarkRemover, calibrated_file, default_remover

log = logging.getLogger(__name__)
MARGIN = 4


def _luma(path: Path) -> np.ndarray | None:
    try:
        rgb = np.asarray(Image.open(path).convert("RGB"))
    except Exception:  # noqa: BLE001 - broken downloads are just skipped
        return None
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def collect_patches(rm: WatermarkRemover, files: Iterable[Path]) -> dict[str, list[np.ndarray]]:
    """Aligned luma patches (template size + MARGIN) per variant, for confidently detected images."""
    out: dict[str, list[np.ndarray]] = {t.name: [] for t in rm.templates}
    for f in files:
        y = _luma(f)
        if y is None:
            continue
        rgb3 = np.repeat(np.clip(y, 0, 255).astype(np.uint8)[..., None], 3, axis=2)
        det = rm.detect(rgb3)
        if det is None:
            continue
        th, tw = rm.template(det.template).alpha.shape
        y0, x0 = det.y - MARGIN, det.x - MARGIN
        if y0 < 0 or x0 < 0 or y0 + th + 2 * MARGIN > y.shape[0] or x0 + tw + 2 * MARGIN > y.shape[1]:
            continue
        out[det.template].append(y[y0 : y0 + th + 2 * MARGIN, x0 : x0 + tw + 2 * MARGIN])
    return out


def estimate_alpha(
    patches: np.ndarray, alpha0: np.ndarray, color: float, iters: int = 3, min_weight: float = 4.0
) -> np.ndarray:
    """Refine `alpha0` from aligned luma patches (N, h+2*MARGIN, w+2*MARGIN).

    Wherever the background B around a pixel (estimated from the neighbouring pixels that are
    not covered by watermark strokes) is smooth, J = B + alpha * (W - B). Per pixel, alpha is
    the weighted least-squares solution over all such images; bright backgrounds (large W - B)
    weigh the most, a white background is the ideal case.
    """
    alpha = np.pad(alpha0, MARGIN).astype(np.float32)
    k = 15 if alpha0.shape[1] > 400 else 9
    support = cv2.dilate((alpha > 0.01).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    for i in range(iters):
        bg = (alpha <= 0.02).astype(np.float32)
        n_bg = cv2.boxFilter(bg, -1, (k, k), normalize=False)
        num = np.zeros_like(alpha)
        den = np.zeros_like(alpha)
        for J in patches:
            s1 = cv2.boxFilter(J * bg, -1, (k, k), normalize=False)
            s2 = cv2.boxFilter(J * J * bg, -1, (k, k), normalize=False)
            with np.errstate(all="ignore"):
                B = s1 / n_bg
                std = np.sqrt(np.maximum(s2 / n_bg - B * B, 0))
            usable = (n_bg >= k) & (std <= 2.0) & (B > color + 60)
            d = np.where(usable, color - B, 0.0)
            num += d * (J - B) * usable
            den += d * d
        weight = den / (255.0 - color) ** 2  # in units of "white-background samples"
        with np.errstate(all="ignore"):
            new = np.clip(num / den, 0, 0.98)
        ok = (weight >= min_weight) & support
        upd = np.where(ok, new, alpha)
        upd[~support] = 0
        upd[upd < 0.008] = 0
        log.info("iter %d: %d images, covered %.1f%% of support, mean |d alpha| = %.5f",
                 i, len(patches), 100 * ok[support].mean(), float(np.abs(upd - alpha).mean()))
        alpha = upd.astype(np.float32)
    return alpha[MARGIN:-MARGIN, MARGIN:-MARGIN]


def calibrate(folder: Path, out: Path | None = None) -> dict[str, int]:
    """Writes the templates to the media volume (picked up after a restart of api/worker)."""
    out = out or calibrated_file()
    out.parent.mkdir(parents=True, exist_ok=True)
    rm = default_remover()
    files = sorted(folder.glob("*.jpg"))
    groups = collect_patches(rm, files)
    alphas, used = {}, {}
    for name in VARIANTS:
        t = rm.template(name)
        ps = groups.get(name, [])
        used[name] = len(ps)
        if len(ps) < 20:
            log.warning("%s: only %d images, keeping the current template", name, len(ps))
            alphas[name] = t.alpha
            continue
        alphas[name] = estimate_alpha(np.stack(ps), t.alpha, rm.color)
    np.savez_compressed(out, **alphas, W=np.float32(rm.color))
    return used
