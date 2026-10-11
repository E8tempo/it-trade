import io

import numpy as np
import pytest
from PIL import Image

from app.images.watermark import Detection, WatermarkRemover, default_remover


def synthetic_photo(w: int, h: int, seed: int = 0) -> np.ndarray:
    """White background with a smooth coloured 'product' and some texture."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.full((h, w, 3), 255.0, np.float32)
    blob = ((xx - w * 0.55) / (w * 0.3)) ** 2 + ((yy - h * 0.5) / (h * 0.25)) ** 2 < 1
    colour = np.stack([90 + 60 * np.sin(xx / 37), 140 + 50 * np.cos(yy / 23), 200 - 80 * (xx / w)], -1)
    img[blob] = colour[blob] + rng.normal(0, 6, (int(blob.sum()), 3))
    img[: h // 6] = np.linspace(20, 60, w)[None, :, None]  # dark band: watermark brightens it
    return np.clip(img, 0, 255).astype(np.uint8)


def apply_watermark(rm: WatermarkRemover, rgb: np.ndarray, det: Detection, color: float | None = None) -> np.ndarray:
    color = rm.color if color is None else color
    h, w = rgb.shape[:2]
    x, y, a = rm.alpha_region(det, w, h)
    out = rgb.astype(np.float32)
    region = out[y : y + a.shape[0], x : x + a.shape[1]]
    out[y : y + a.shape[0], x : x + a.shape[1]] = a[..., None] * color + (1 - a[..., None]) * region
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def expected_detection(rm: WatermarkRemover, name: str, w: int, h: int, rotated: bool = False) -> Detection:
    t = rm.template(name)
    iw, ih = (h, w) if rotated else (w, h)
    x, y = rm.expected_xy(t, iw, ih)
    return Detection(name, x, y, 1.0, 1.0, rotated)


@pytest.mark.parametrize(
    ("w", "h", "variant", "rotated"),
    [(800, 800, "big", False), (1200, 700, "big", False), (600, 800, "mid", False), (450, 450, "small", False), (500, 1100, "big", True), (280, 590, "mid", True)],
)
def test_detects_and_removes(w, h, variant, rotated):
    rm = default_remover()
    clean = synthetic_photo(w, h)
    truth = expected_detection(rm, variant, w, h, rotated)
    marked = apply_watermark(rm, clean, truth)

    det = rm.detect(marked)
    assert det is not None
    assert (det.template, det.rotated) == (variant, rotated)
    assert abs(det.x - truth.x) <= 1 and abs(det.y - truth.y) <= 1

    restored, _ = rm.remove(marked, det, chroma_subsampling=(1, 1))
    diff = np.abs(restored.astype(int) - clean.astype(int))
    assert diff.mean() < 0.3
    assert np.percentile(diff, 99.9) <= 2


def test_jpeg_roundtrip_quality():
    rm = default_remover()
    clean = synthetic_photo(800, 800, seed=1)
    marked = apply_watermark(rm, clean, expected_detection(rm, "big", 800, 800))
    buf = io.BytesIO()
    Image.fromarray(marked).save(buf, "JPEG", quality=90, subsampling=2)  # 4:2:0 like the supplier
    jpeg = np.asarray(Image.open(io.BytesIO(buf.getvalue())).convert("RGB"))

    buf = io.BytesIO()
    Image.fromarray(clean).save(buf, "JPEG", quality=90, subsampling=2)
    clean_jpeg = np.asarray(Image.open(io.BytesIO(buf.getvalue())).convert("RGB"))

    restored, det = rm.remove(jpeg, chroma_subsampling=(2, 2))
    assert det is not None
    x, y, a = rm.alpha_region(det, 800, 800)
    mask = np.zeros((800, 800), bool)
    mask[y : y + a.shape[0], x : x + a.shape[1]] = a > 0.05

    def err(img):
        return np.abs(img.astype(int) - clean.astype(int))[mask].mean()

    assert err(jpeg) > 40  # the watermark is clearly there
    # gone, up to the JPEG noise (amplified by 1 / (1 - alpha) inside the strokes)
    assert err(restored) < 1.5 * err(clean_jpeg)


@pytest.mark.parametrize(("w", "h"), [(800, 800), (600, 800), (300, 800), (800, 150)])
def test_clean_photo_is_left_untouched(w, h):
    rm = default_remover()
    photo = synthetic_photo(w, h, seed=2)
    out, det = rm.remove(photo)
    assert det is None
    assert out is photo


def test_double_watermark_is_removed_layer_by_layer():
    rm = default_remover()
    clean = synthetic_photo(800, 800, seed=4)
    det = expected_detection(rm, "big", 800, 800)
    once = apply_watermark(rm, clean, det)
    twice = apply_watermark(rm, once, det)  # an already watermarked photo watermarked again

    restored, found = rm.remove(twice, chroma_subsampling=(1, 1))
    assert found is not None and found.layers == 2
    assert np.abs(restored.astype(int) - clean.astype(int)).mean() < 0.5

    # a single watermark is removed exactly once (no "negative" second pass)
    restored, found = rm.remove(once, chroma_subsampling=(1, 1))
    assert found is not None and found.layers == 1


def test_small_watermark_on_300px_photo_and_triple_layer():
    rm = default_remover()
    clean = synthetic_photo(300, 300, seed=5)
    det = expected_detection(rm, "small", 300, 300)
    restored, found = rm.remove(apply_watermark(rm, clean, det), chroma_subsampling=(1, 1))
    assert found is not None and found.template == "small"
    assert np.abs(restored.astype(int) - clean.astype(int)).mean() < 0.5

    clean = synthetic_photo(800, 800, seed=6)
    det = expected_detection(rm, "big", 800, 800)
    triple = clean
    for _ in range(3):
        triple = apply_watermark(rm, triple, det)
    restored, found = rm.remove(triple, chroma_subsampling=(1, 1))
    assert found is not None and found.layers == 3
    assert np.abs(restored.astype(int) - clean.astype(int)).mean() < 1.0


@pytest.mark.parametrize("color", [0.0, 12.0, 45.0])
def test_watermark_colour_is_fitted_per_photo(color):
    """Some photos carry a black or a slightly darker / lighter mark than the calibrated one."""
    rm = default_remover()
    clean = synthetic_photo(800, 800, seed=7)
    det = expected_detection(rm, "big", 800, 800)
    restored, found = rm.remove(apply_watermark(rm, clean, det, color), chroma_subsampling=(1, 1))
    assert found is not None and found.layers == 1 and abs(found.color - color) < 3
    assert np.abs(restored.astype(int) - clean.astype(int)).mean() < 0.5


def test_stacked_grey_mark_over_dark_part_is_not_taken_for_black():
    """On white a double black mark and a double grey one restore the same after clipping at 255,
    but the black one would leave a light ghost over darker parts of the product."""
    rm = default_remover()
    clean = np.full((800, 800, 3), 255, np.uint8)
    clean[:, 300:420] = 35  # a dark part of the product crossing the mark
    det = expected_detection(rm, "big", 800, 800)
    twice = apply_watermark(rm, apply_watermark(rm, clean, det), det)
    restored, found = rm.remove(twice, chroma_subsampling=(1, 1))
    assert found is not None and found.layers == 2 and found.color > 20
    assert np.abs(restored[:, 300:420].astype(int) - 35).mean() < 1.0
