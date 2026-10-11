"""Removal of the supplier's semi-transparent "IT Partner" watermark.

The watermark is a single grey colour `W` alpha-blended over the photo:

    J = alpha * W + (1 - alpha) * I        (J - watermarked pixel, I - original pixel)

`alpha` and `W` were estimated from ~800 watermarked images (see `calibrate.py`), so the
original is recovered by inverting the blend:

    I = (J - alpha * W) / (1 - alpha)

How the supplier draws it (measured on samples):
  * centred, in one of four fixed pixel sizes picked by the image width:
    >=~700px - big (680 px wide), ~500..700 - mid, ~300..500 - small, narrower - tiny (104 px);
  * on tall images (height >= ~2 x width) it is rotated by 90 degrees and the size is
    picked by the height instead;
  * it is not scaled down to fit: on banners and narrow images part of it falls outside;
  * some photos carry it two or three times at the same place, all drawn before one JPEG
    encode. L layers of colours W_1..W_L blend as
        J = (1-a)^L * I + sum_l W_l * a * (1-a)^(L-l)
    and are inverted in one step. Each layer adds ~1 to the detection strength k;
  * the colour varies between photos (some marks are near-black, it also absorbs small
    opacity differences of the templates), so it is fitted per photo on the strokes over
    smooth background, with the background B taken from the neighbouring pixels. Of the
    layer counts allowed by k, the one that restores those pixels best wins. The error is
    measured on the restored pixels, not on the watermarked ones: on white an over-strong
    model is clipped at 255 and would look perfect there while leaving a light ghost
    over darker parts of the product;
  * JPEG stores chroma at half resolution and smooths it further, so chroma is restored
    with the alpha averaged over the 2x2 blocks and slightly blurred: the sharp alpha
    would leave coloured fringes, an unblurred one more saturated strokes.

Detection is a matched filter: around the expected position the image gradient is
correlated with the gradient the watermark would produce over the local background,
`G = (W - background) * grad(alpha)`. Using the local background makes it work on dark
photos too, where the watermark brightens instead of darkening. The projection
coefficient `k = <grad J, G> / <G, G>` must be close to 1 (it is the watermark strength
relative to the template), which rejects textures that merely correlate by chance.
"""

import math
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

DATA_FILE = Path(__file__).parent / "data" / "itp_watermark.npz"
VARIANTS = ("big", "mid", "small", "tiny")
# Image widths each variant is drawn on (with some tolerance around the supplier's thresholds).
VARIANT_WIDTHS = {"big": (680, 1 << 30), "mid": (480, 720), "small": (290, 520), "tiny": (0, 296)}
TINY_SIZE = (104, 36)  # the big template scaled down, until a calibrated one is in the data file
ROTATED_FROM, NORMAL_UNTIL = 1.85, 2.2  # h/w ratios: rotated watermark above, normal below
SEARCH_RADIUS = 1  # px around the expected (centred) position
# Measured on ~800 samples: watermarked p1 corr=0.067 / k=0.77..1.3, clean photos p95 corr=0.05.
# A strong correlation is trusted with a wider k range: on dark photos (background ~ W) the
# expected gradient G is tiny and k gets noisy.
MIN_CORR, K_RANGE = 0.05, (0.6, 1.6)
STRONG_CORR, STRONG_K_RANGE = 0.09, (0.4, 2.5)
# a watermark stacked two or three times (k up to ~3.3) is accepted only with a clear match
STACKED_CORR, STACKED_K_RANGE = 0.3, (2.5, 3.6)
# such a correlation cannot be a coincidence; k is meaningless on near-black photos (G ~ 0)
CERTAIN_CORR = 0.5
# Share of the watermark mass allowed to fall outside the image; a placement clipped by more than
# 1% (banners, narrow images) needs a clear match.
MAX_CLIPPED_ALPHA, CLIPPED_MIN_CORR = 0.25, 0.2
# the tiny template covers few pixels, so textures match it by chance more often: on clean photos
# scaled to its widths up to corr 0.19, real tiny marks 0.29..0.96
TINY_MIN_CORR = 0.25
MAX_LAYERS = 3
# Without enough smooth background to fit the colours, the calibrated grey is used and another
# layer is added while at least this much watermark (k) is left, if that reduces |k| by
# LAYER_MIN_GAIN: every real layer accounts for k ~1, while a pass over an already clean image
# just flips the sign of a small JPEG-noise residual (0.5 -> -0.5).
LAYER_MIN_RESIDUAL = 0.5
LAYER_MIN_GAIN = 0.4
BG_RADIUS, BG_MAX_STD = 6, 6.0  # local background estimate for the colour fit
FIT_MIN_PIXELS = 100  # stroke pixels over smooth background needed to fit the colours
FIT_GAIN = 0.85  # more layers or per-layer colours only if they cut the restoration error by 15%
COLOUR_RANGE = (-25.0, 85.0)  # plausible fitted colours, a fit outside means a wrong layer count
CHROMA_BLUR = 0.8  # px, measured on double marks over colourful backgrounds


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
    layers: int = 1  # how many times the watermark was found stacked at this place (set by remove)
    color: float | None = None  # watermark colour used for the removal (set by remove)


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
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    ts = (slice(iy0 - y, iy1 - y), slice(ix0 - x, ix1 - x))
    if _clipped(t, ts) > MAX_CLIPPED_ALPHA:
        return None
    return slice(iy0, iy1), slice(ix0, ix1), ts[0], ts[1]


def _clipped(t: Template, ts: tuple[slice, slice]) -> float:
    """Share of the template's alpha mass outside the visible slices `ts`."""
    return 1 - float(t.alpha[ts].sum()) / t.mass


def _local_background(J: np.ndarray, a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per pixel: mean of the neighbouring non-stroke pixels, and where strokes lie on smooth background."""
    bg = (a < 0.01).astype(np.float32)
    k = 2 * BG_RADIUS + 1
    n = cv2.boxFilter(bg, -1, (k, k), normalize=False)
    s1 = cv2.boxFilter(J * bg, -1, (k, k), normalize=False)
    s2 = cv2.boxFilter(J * J * bg, -1, (k, k), normalize=False)
    with np.errstate(all="ignore"):
        mean = s1 / n
        std = np.sqrt(np.maximum(s2 / n - mean * mean, 0))
    smooth = (a > 0.3) & (n >= k) & (std <= BG_MAX_STD)
    return np.nan_to_num(mean), smooth


class WatermarkRemover:
    def __init__(self, alphas: dict[str, np.ndarray], color: float):
        self.color = float(color)
        self.templates = [_make_template(name, a) for name, a in alphas.items()]

    @classmethod
    def from_file(cls, path: Path = DATA_FILE) -> "WatermarkRemover":
        d = np.load(path)
        alphas = {v: d[v] for v in VARIANTS if v in d.files}
        if "tiny" not in alphas:
            alphas["tiny"] = cv2.resize(alphas["big"].astype(np.float32), TINY_SIZE, interpolation=cv2.INTER_AREA)
        return cls(alphas, float(d["W"]))

    def template(self, name: str) -> Template:
        return next(t for t in self.templates if t.name == name)

    # --- detection --------------------------------------------------------------------------

    @staticmethod
    def expected_xy(t: Template, w: int, h: int) -> tuple[int, int]:
        th, tw = t.alpha.shape
        return math.ceil((w - tw) / 2), math.ceil((h - th) / 2)

    def match(self, y: np.ndarray, t: Template, x0: int, y0: int, color: float | None = None) -> tuple[float, float]:
        """(correlation, strength k) of template `t` placed at (x0, y0) over the luma image `y`."""
        c = self.color if color is None else color
        sl = _overlap(t, x0, y0, y.shape[1], y.shape[0])
        if sl is None:
            return 0.0, 0.0
        J = y[sl[0], sl[1]]
        a, tgx, tgy = t.alpha[sl[2], sl[3]], t.gx[sl[2], sl[3]], t.gy[sl[2], sl[3]]
        background = cv2.GaussianBlur((J - a * c) / (1.0 - a), (0, 0), 2.0)
        jx, jy = _grad(J)
        d = c - background
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
        if best.score < CLIPPED_MIN_CORR and self._clipped_share(best, w, h) > 0.01:
            return None
        if best.template == "tiny" and best.score < TINY_MIN_CORR:
            return None
        if best.score >= CERTAIN_CORR and best.strength > 0.3:
            return best
        if best.score >= STACKED_CORR and STACKED_K_RANGE[0] <= best.strength <= STACKED_K_RANGE[1]:
            return best
        if best.score >= STRONG_CORR and STRONG_K_RANGE[0] <= best.strength <= STRONG_K_RANGE[1]:
            return best
        if best.score >= MIN_CORR and K_RANGE[0] <= best.strength <= K_RANGE[1]:
            return best
        return None

    def _clipped_share(self, det: Detection, w: int, h: int) -> float:
        t = self.template(det.template)
        iw, ih = (h, w) if det.rotated else (w, h)
        th, tw = t.alpha.shape
        ts = (slice(max(0, -det.y), min(th, ih - det.y)), slice(max(0, -det.x), min(tw, iw - det.x)))
        return _clipped(t, ts)

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

    def residual(self, rgb: np.ndarray, det: Detection, color: float | None = None) -> float:
        """Watermark strength k left at the detected place."""
        y = luma(rgb)
        if det.rotated:
            y = np.ascontiguousarray(np.rot90(y, 1))
        return self.match(y, self.template(det.template), det.x, det.y, color)[1]

    def remove(
        self, rgb: np.ndarray, det: Detection | None = None, chroma_subsampling: tuple[int, int] = (2, 2)
    ) -> tuple[np.ndarray, Detection | None]:
        """Returns (clean RGB uint8 image, detection). The image is returned as is if no watermark is found.

        `chroma_subsampling` = (sx, sy) of the source JPEG, (2, 2) for 4:2:0.
        """
        det = det or self.detect(rgb)
        if det is None:
            return rgb, None
        colours = self._fit_colours(rgb, det) or [self.color] * self._count_layers(rgb, det, chroma_subsampling)
        out = self._invert(rgb, det, chroma_subsampling, colours)
        return out, replace(det, layers=len(colours), color=float(np.mean(colours)))

    def _fit_colours(self, rgb: np.ndarray, det: Detection) -> list[float] | None:
        """Colour of every layer fitted on the strokes over smooth background, None without enough of it.

        Layer counts up to round(k) are tried, for two and more layers also with a colour per
        layer; a more complex model has to cut the restoration error by 1 - FIT_GAIN.
        """
        H, W = rgb.shape[:2]
        ax, ay, a = self.alpha_region(det, W, H)
        J = luma(rgb[ay : ay + a.shape[0], ax : ax + a.shape[1]])
        background, smooth = _local_background(J, a)
        if smooth.sum() < FIT_MIN_PIXELS:
            return None
        a, J, B = a[smooth], J[smooth], background[smooth]
        best: tuple[float, list[float]] | None = None
        for layers in range(1, int(np.clip(math.floor(det.strength + 0.5), 1, MAX_LAYERS)) + 1):
            for shared in (True, False) if layers > 1 else (True,):
                colours = _fit_layers(a, J, B, layers, shared)
                if not all(COLOUR_RANGE[0] <= c <= COLOUR_RANGE[1] for c in colours):
                    continue
                g, h = _blend(a, colours)
                error = float(np.abs((J - g * B - h) / g).mean())  # restored minus background
                if best is None or error < FIT_GAIN * best[0]:
                    best = (error, colours)
        return best[1] if best else None

    def _count_layers(self, rgb: np.ndarray, det: Detection, chroma_subsampling: tuple[int, int]) -> int:
        """Layers of the calibrated grey: added while the residual strength k clearly drops."""
        left = self.residual(self._invert(rgb, det, chroma_subsampling, [self.color]), det)
        layers = 1
        while layers < MAX_LAYERS and left >= LAYER_MIN_RESIDUAL:
            after = self.residual(self._invert(rgb, det, chroma_subsampling, [self.color] * (layers + 1)), det)
            if abs(after) > left - LAYER_MIN_GAIN:
                break
            left, layers = after, layers + 1
        return layers

    def _invert(
        self, rgb: np.ndarray, det: Detection, chroma_subsampling: tuple[int, int], colours: list[float]
    ) -> np.ndarray:
        """Inversion of len(colours) stacked layers at the detected place."""
        H, W = rgb.shape[:2]
        ax, ay, alpha = self.alpha_region(det, W, H)
        ah, aw = alpha.shape
        sx, sy = chroma_subsampling
        # working region: aligned to the chroma block grid, plus a margin for upsampling and blur
        x0, y0 = max(0, (ax - 6) // sx * sx), max(0, (ay - 6) // sy * sy)
        x1, y1 = min(W, ax + aw + 6 + sx), min(H, ay + ah + 6 + sy)
        rw, rh = x1 - x0, y1 - y0
        a = np.zeros((rh, rw), np.float32)
        a[ay - y0 : ay - y0 + ah, ax - x0 : ax - x0 + aw] = alpha
        g, h = _blend(a, colours)
        if (sx, sy) != (1, 1):
            cw, ch = -(-rw // sx), -(-rh // sy)
            pad = np.ones((ch * sy, cw * sx), np.float32)
            pad[:rh, :rw] = g
            blocks = pad.reshape(ch, sy, cw, sx).mean(axis=(1, 3))
            g_c = cv2.resize(blocks, (cw * sx, ch * sy), interpolation=cv2.INTER_LINEAR)[:rh, :rw]
            g_c = cv2.GaussianBlur(g_c, (0, 0), CHROMA_BLUR)
        else:
            g_c = g

        # The watermark is grey, so with luma Y and chroma offsets C = RGB - Y:
        #   Y_J = g*Y_I + h,   C_J = g*C_I
        J = rgb[y0:y1, x0:x1].astype(np.float32)
        Y = luma(J)
        C = J - Y[..., None]
        Y = (Y - h) / g
        C = C / g_c[..., None]
        out = rgb.copy()
        out[y0:y1, x0:x1] = np.clip(Y[..., None] + C + 0.5, 0, 255).astype(np.uint8)
        return out


def _blend(a: np.ndarray, colours: list[float]) -> tuple[np.ndarray, np.ndarray]:
    """(g, h) of J = g*I + h for len(colours) layers drawn in this order with alpha `a`."""
    layers = len(colours)
    g = (1 - a) ** layers
    h = sum(c * a * (1 - a) ** (layers - i) for i, c in enumerate(colours, 1))
    return g, h


def _fit_layers(a: np.ndarray, J: np.ndarray, B: np.ndarray, layers: int, shared: bool) -> list[float]:
    """Layer colours of J = g*B + h by least squares, iteratively down-weighting outliers (Huber)
    such as stroke pixels whose neighbours misjudge the background."""
    g = (1 - a) ** layers
    y = J - g * B
    if shared:  # all layers of one colour: h = W * (1 - g)
        X = (1 - g)[:, None]
    else:
        X = np.stack([a * (1 - a) ** (layers - i) for i in range(1, layers + 1)], 1)
    w = np.ones_like(y)
    for _ in range(6):
        sw = np.sqrt(w)
        beta = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)[0]
        r = np.abs(y - X @ beta)
        w = np.minimum(1.0, 1.5 * (1.4826 * float(np.median(r)) + 1e-3) / np.maximum(r, 1e-6))
    return [float(c) for c in (np.repeat(beta, layers) if shared else beta)]


def calibrated_file() -> Path:
    """Templates rebuilt by `app.cli watermark-calibrate` live on the persistent media volume."""
    from app.config import get_settings

    return get_settings().media_root / "watermark" / "itp_watermark.npz"


@lru_cache
def default_remover() -> WatermarkRemover:
    override = calibrated_file()
    return WatermarkRemover.from_file(override if override.exists() else DATA_FILE)
