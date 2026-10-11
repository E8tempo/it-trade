import io
from dataclasses import replace

import cv2
import numpy as np
import pytest
from PIL import Image

from app.images.watermark import Detection, WatermarkRemover, _plausible, default_remover


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


@pytest.mark.parametrize("offset", [(1, 0), (0, -1), (-1, 1)])
def test_detection_one_pixel_off_is_moved_back(offset):
    """Strong product edges can pull the detector 1 px off; restored there, the letters would stay embossed."""
    rm = default_remover()
    clean = synthetic_photo(800, 800, seed=3)
    truth = expected_detection(rm, "big", 800, 800)
    wrong = replace(truth, x=truth.x + offset[0], y=truth.y + offset[1])
    restored, found = rm.remove(apply_watermark(rm, clean, truth), wrong, chroma_subsampling=(1, 1))
    assert found is not None and (found.x, found.y) == (truth.x, truth.y)
    diff = np.abs(restored.astype(int) - clean.astype(int))
    assert diff.mean() < 0.3
    assert np.percentile(diff, 99.9) <= 2


def test_ghost_on_plain_surface_is_cleaned_without_blurring_edges():
    """A mark a bit blurrier than the template (the photo was resampled after watermarking) fits no
    model of the strokes and the inversion leaves outlines; on plain surfaces they are inpainted away."""
    rm = default_remover()
    det = expected_detection(rm, "big", 800, 800)
    x, y, a = rm.alpha_region(det, 800, 800)
    clean = np.empty((800, 800, 3), np.uint8)
    clean[:] = (150, 160, 175)
    clean[:, 400:] = (70, 72, 80)  # a sharp product edge right through the mark
    box = (slice(y, y + a.shape[0]), slice(x, x + a.shape[1]))
    blurred = cv2.GaussianBlur(a, (0, 0), 0.7)[..., None]
    marked = clean.astype(np.float32)
    marked[box] = blurred * rm.color + (1 - blurred) * marked[box]
    marked = np.clip(marked + 0.5, 0, 255).astype(np.uint8)

    restored, _ = rm.remove(marked, det, chroma_subsampling=(1, 1))
    err = np.abs(restored.astype(int) - clean.astype(int)).max(-1)
    strokes = np.zeros((800, 800), bool)
    strokes[box] = a > 0.01
    plain = strokes & (np.abs(np.arange(800) - 400) > 25)[None, :]
    assert err[plain].mean() < 2  # 4.2 without the cleanup; differences under 1..2 levels are left alone
    assert np.percentile(err[plain], 99) <= 5
    rows = np.flatnonzero(strokes[:, 395:405].any(axis=1))
    step = restored[rows, 398].astype(int) - restored[rows, 401].astype(int)
    assert step.min() > 60  # still a one pixel edge (80 levels in the clean photo)


def test_layer_colours_are_judged_as_a_stack():
    """Two layers that differ a little in shape fit with odd colours, yet the stack is still a grey."""
    assert _plausible([-92.5, 95.0], 0.47)
    assert not _plausible([-92.5, 20.0], 0.47)  # below black at low opacity
    assert not _plausible([31.0, 200.0], 0.47)


def test_calibration_recovers_a_sharp_template(tmp_path):
    """Starting from a blurred big template, calibration on photos marked with the true one gets back to it."""
    from app.images.calibrate import calibrate
    from app.images.watermark import WatermarkRemover

    true = default_remover()
    d = {t.name: t.alpha for t in true.templates}
    blurred = WatermarkRemover({**d, "big": cv2.GaussianBlur(d["big"], (0, 0), 0.6)}, true.color)
    rng = np.random.default_rng(0)
    det = expected_detection(true, "big", 800, 800)
    for i in range(24):
        photo = np.full((800, 800, 3), 255, np.uint8)
        x = int(rng.integers(0, 600))
        photo[150:650, x : x + 150] = rng.integers(40, 200, 3)  # a product somewhere under the mark
        Image.fromarray(apply_watermark(true, photo, det)).save(tmp_path / f"{i}.jpg", quality=95)
    out = tmp_path / "templates.npz"
    used = calibrate(tmp_path, out, blurred)
    assert used["big"] >= 20
    new, sharp, old = np.load(out)["big"], d["big"], blurred.template("big").alpha
    strokes = sharp > 0.01
    assert np.abs(new - sharp)[strokes].mean() < 0.3 * np.abs(old - sharp)[strokes].mean()
