"""Removal of the supplier's semi-transparent "IT Partner" watermark.

The watermark is a single grey colour `W` alpha-blended over the photo:

    J = alpha * W + (1 - alpha) * I        (J - watermarked pixel, I - original pixel)

`alpha` and `W` were estimated from ~800 watermarked images (see `calibrate.py`), so the
original is recovered by inverting the blend:

    I = (J - alpha * W) / (1 - alpha)

How the supplier draws it (measured on samples):
  * centred, in one of three fixed pixel sizes picked by the image width:
    >=~700px - big, ~500..700 - mid, ~400..500 - small, narrower - none;
  * on tall images (height >= ~2 x width) it is rotated by 90 degrees and the size is
    picked by the height instead.

Detection is a matched filter: around the expected position the image gradient is
correlated with the gradient the watermark would produce over the local background,
`G = (W - background) * grad(alpha)`. Using the local background makes it work on dark
photos too, where the watermark brightens instead of darkening. The projection
coefficient `k = <grad J, G> / <G, G>` must be close to 1 (it is the watermark strength
relative to the template), which rejects textures that merely correlate by chance.
"""

import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

DATA_FILE = Path(__file__).parent / "data" / "itp_watermark.npz"
VARIANTS = ("big", "mid", "small")
# Image widths each variant is drawn on (with some tolerance around the supplier's thresholds).
VARIANT_WIDTHS = {"big": (680, 1 << 30), "mid": (480, 720), "small": (330, 520)}
ROTATED_FROM, NORMAL_UNTIL = 1.85, 2.2  # h/w ratios: rotated watermark above, normal below
SEARCH_RADIUS = 1  # px around the expected (centred) position
# Measured on ~800 samples: watermarked p1 corr=0.067 / k=0.77..1.3, clean photos p95 corr=0.05.
# A strong correlation is trusted with a wider k range: on dark photos (background ~ W) the
# expected gradient G is tiny and k gets noisy.
MIN_CORR, K_RANGE = 0.05, (0.6, 1.6)
STRONG_CORR, STRONG_K_RANGE = 0.09, (0.4, 2.5)
MAX_CLIPPED_ALPHA = 0.01  # share of the watermark allowed to fall outside the image


@dataclass(frozen=True)
class Template:
    name: str
    alpha: np.ndarray  # float32 (h, w), even dims, patch centre == image centre
    gx: np.ndarray
    gy: np.ndarray
    mass: float


@dataclass(frozen=True)
class Detection:
    template: str
    x: int  # top-left of the template in the (possibly rotated) image, may be negative
    y: int
    score: float  # normalised correlation with the expected watermark gradient
    strength: float  # projection coefficient k, ~1 for a real watermark
    rotated: bool = False  # found on the image rotated by 90 degrees counter-clockwise


def _grad(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3)


def _make_template(name: str, alpha: np.ndarray) -> Template:
    alpha = np.ascontiguousarray(alpha, dtype=np.float32)
    gx, gy = _grad(alpha)
    return Template(name, alpha, gx, gy, float(alpha.sum()))


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)


def _overlap(t: Template, x: int, y: int, w: int, h: int) -> tuple[slice, slice, slice, slice] | None:
    """Image and template slices of a placement, or None if too much of the watermark is clipped."""
    th, tw = t.alpha.shape
    ix0, iy0, ix1, iy1 = max(0, x), max(0, y), min(w, x + tw), min(h, y + th)
    if ix1 - ix0 < tw // 2 or iy1 - iy0 < th // 2:
        return None
    ts = (slice(iy0 - y, iy1 - y), slice(ix0 - x, ix1 - x))
    if (ix0, iy0, ix1, iy1) != (x, y, x + tw, y + th):
        if 1 - t.alpha[ts].sum() / t.mass > MAX_CLIPPED_ALPHA:
            return None
    return slice(iy0, iy1), slice(ix0, ix1), ts[0], ts[1]


class WatermarkRemover:
    def __init__(self, alphas: dict[str, np.ndarray], color: float):
        self.color = float(color)
        self.templates = [_make_template(name, a) for name, a in alphas.items()]

    @classmethod
    def from_file(cls, path: Path = DATA_FILE) -> "WatermarkRemover":
        d = np.load(path)
        return cls({v: d[v] for v in VARIANTS if v in d.files}, float(d["W"]))

    def template(self, name: str) -> Template:
        return next(t for t in self.templates if t.name == name)

    # --- detection --------------------------------------------------------------------------

    @staticmethod
    def expected_xy(t: Template, w: int, h: int) -> tuple[int, int]:
        th, tw = t.alpha.shape
        return math.ceil((w - tw) / 2), math.ceil((h - th) / 2)

    def match(self, y: np.ndarray, t: Template, x0: int, y0: int) -> tuple[float, float]:
        """(correlation, strength k) of template `t` placed at (x0, y0) over the luma image `y`."""
        sl = _overlap(t, x0, y0, y.shape[1], y.shape[0])
        if sl is None:
            return 0.0, 0.0
        J = y[sl[0], sl[1]]
        a, tgx, tgy = t.alpha[sl[2], sl[3]], t.gx[sl[2], sl[3]], t.gy[sl[2], sl[3]]
        background = cv2.GaussianBlur((J - a * self.color) / (1.0 - a), (0, 0), 2.0)
        jx, jy = _grad(J)
        d = self.color - background
        gx, gy = d * tgx, d * tgy
        gg = float((gx * gx + gy * gy).sum())
        jj = float((jx * jx + jy * jy).sum())
        if gg < 1e-6 or jj < 1e-6:
            return 0.0, 0.0
        dot = float((jx * gx + jy * gy).sum())
        return dot / math.sqrt(gg * jj), dot / gg

    def detect(self, rgb: np.ndarray) -> Detection | None:
        y = luma(rgb)
        h, w = y.shape
        orientations = []
        if h < NORMAL_UNTIL * w:
            orientations.append(False)
        if h >= ROTATED_FROM * w:
            orientations.append(True)
        best: Detection | None = None
        for rotated in orientations:
            img = np.ascontiguousarray(np.rot90(y, 1)) if rotated else y
            ih, iw = img.shape
            for t in self.templates:
                lo, hi = VARIANT_WIDTHS.get(t.name, (0, 1 << 30))
                if not lo <= iw <= hi:
                    continue
                ex, ey = self.expected_xy(t, iw, ih)
                for dy in range(-SEARCH_RADIUS, SEARCH_RADIUS + 1):
                    for dx in range(-SEARCH_RADIUS, SEARCH_RADIUS + 1):
                        corr, k = self.match(img, t, ex + dx, ey + dy)
                        if best is None or corr > best.score:
                            best = Detection(t.name, ex + dx, ey + dy, corr, k, rotated)
        if best is None:
            return None
        if best.score >= STRONG_CORR and STRONG_K_RANGE[0] <= best.strength <= STRONG_K_RANGE[1]:
            return best
        if best.score >= MIN_CORR and K_RANGE[0] <= best.strength <= K_RANGE[1]:
            return best
        return None

    # --- removal ----------------------------------------------------------------------------

    def alpha_region(self, det: Detection, w: int, h: int) -> tuple[int, int, np.ndarray]:
        """(x, y, alpha) of the watermark in the original (unrotated) image of size w x h."""
        t = self.template(det.template)
        th, tw = t.alpha.shape
        if not det.rotated:
            x, y, a = det.x, det.y, t.alpha
        else:
            # rot90(img, 1)[i, j] == img[j, w - 1 - i]
            x, y, a = w - det.y - th, det.x, np.rot90(t.alpha, -1)
        ah, aw = a.shape
        x0, y0 = max(0, x), max(0, y)
        a = a[y0 - y : min(h, y + ah) - y, x0 - x : min(w, x + aw) - x]
        return x0, y0, np.ascontiguousarray(a)

    def remove(
        self, rgb: np.ndarray, det: Detection | None = None, chroma_subsampling: tuple[int, int] = (2, 2)
    ) -> tuple[np.ndarray, Detection | None]:
        """Returns (clean RGB uint8 image, detection). The image is returned as is if no watermark is found.

        Luma is restored with the sharp alpha, chroma with the alpha averaged over the JPEG
        chroma blocks (`chroma_subsampling` = (sx, sy), (2, 2) for 4:2:0): the source's chroma
        was subsampled after watermarking, so the sharp alpha would leave coloured fringes.
        """
        det = det or self.detect(rgb)
        if det is None:
            return rgb, None
        H, W = rgb.shape[:2]
        ax, ay, alpha = self.alpha_region(det, W, H)
        ah, aw = alpha.shape
        sx, sy = chroma_subsampling
        # working region: aligned to the chroma block grid, plus a margin for the upsampling filter
        x0, y0 = max(0, (ax - 2) // sx * sx), max(0, (ay - 2) // sy * sy)
        x1, y1 = min(W, ax + aw + 2 + sx), min(H, ay + ah + 2 + sy)
        rw, rh = x1 - x0, y1 - y0
        a = np.zeros((rh, rw), np.float32)
        a[ay - y0 : ay - y0 + ah, ax - x0 : ax - x0 + aw] = alpha
        if (sx, sy) != (1, 1):
            cw, ch = -(-rw // sx), -(-rh // sy)
            pad = np.zeros((ch * sy, cw * sx), np.float32)
            pad[:rh, :rw] = a
            blocks = pad.reshape(ch, sy, cw, sx).mean(axis=(1, 3))
            a_c = cv2.resize(blocks, (cw * sx, ch * sy), interpolation=cv2.INTER_LINEAR)[:rh, :rw]
        else:
            a_c = a

        # The watermark is grey, so with luma Y and chroma offsets C = RGB - Y:
        #   Y_J = a*W + (1-a)*Y_I,   C_J = (1-a)*C_I
        J = rgb[y0:y1, x0:x1].astype(np.float32)
        Y = luma(J)
        C = J - Y[..., None]
        Y = (Y - a * self.color) / (1.0 - a)
        C = C / (1.0 - a_c[..., None])
        out = rgb.copy()
        out[y0:y1, x0:x1] = np.clip(Y[..., None] + C + 0.5, 0, 255).astype(np.uint8)
        return out, det


def calibrated_file() -> Path:
    """Templates rebuilt by `app.cli watermark-calibrate` live on the persistent media volume."""
    from app.config import get_settings

    return get_settings().media_root / "watermark" / "itp_watermark.npz"


@lru_cache
def default_remover() -> WatermarkRemover:
    override = calibrated_file()
    return WatermarkRemover.from_file(override if override.exists() else DATA_FILE)
