from types import SimpleNamespace

import numpy as np

from app.images.gallery import CELLS, copies, gallery


def photo(id: int, width: int | None = 800, height: int | None = 800, duplicate_of: int | None = None):
    return SimpleNamespace(id=id, width=width, height=height, duplicate_of=duplicate_of)


def product_on_white(seed: int) -> np.ndarray:
    """Thumbnail of a product photo: a coloured product in the middle of a white background."""
    rng = np.random.default_rng(seed)
    t = np.full((CELLS, CELLS, 3), 255.0, np.float32)
    t[3:14, 4:12] = rng.uniform(0, 200, (11, 8, 3))
    return t


def slide(seed: int) -> np.ndarray:
    """Thumbnail of a marketing slide: a designed background with the product, text at the top."""
    rng = np.random.default_rng(seed)
    t = np.empty((CELLS, CELLS, 3), np.float32)
    t[:] = rng.uniform(80, 200, 3)
    t[6:15, 4:12] = rng.uniform(0, 255, (9, 8, 3))
    t[1:4, 2:14] = rng.uniform(0, 255, (3, 12, 3))  # text
    return t


def test_reupload_in_another_size_is_one_photo():
    shot = product_on_white(1)
    small, other, large = photo(1, 750, 600), photo(2, 750, 600), photo(3, 1500, 1200)
    links = copies([(small, shot), (other, product_on_white(2)), (large, shot + 2)])
    assert links == {1: 3, 2: None, 3: None}


def test_variants_of_a_product_stay():
    shot = product_on_white(1)
    recoloured = shot.copy()
    recoloured[3:14, 4:12] = 255 - recoloured[3:14, 4:12]  # the same product in another colour
    # a thin product on white: 90% of the cells are background, yet another height is another photo
    pole = np.full((CELLS, CELLS, 3), 255.0, np.float32)
    pole[2:15, 7] = 40
    shorter = np.full((CELLS, CELLS, 3), 255.0, np.float32)
    shorter[8:15, 7] = 40
    shorter[8, 5:10] = 40
    links = copies([(photo(1), shot), (photo(2), recoloured), (photo(3), pole), (photo(4), shorter)])
    assert all(kept is None for kept in links.values())


def test_slide_in_another_language_is_one_photo():
    base = slide(5)
    translated = base.copy()
    translated[1:4, 2:14] = np.random.default_rng(6).uniform(0, 255, (3, 12, 3))
    other = base.copy()
    other[8:12, 4:12] = 255 - other[8:12, 4:12]  # the product itself differs: another slide
    links = copies([(photo(1, 900, 900), base), (photo(2, 900, 900), translated), (photo(3, 900, 900), other)])
    assert links == {1: None, 2: 1, 3: None}

    # on white, a difference at the top is another photo of the product (a part folded, an accessory)
    shot = product_on_white(7)
    changed = shot.copy()
    changed[3:5, 4:12] = 255 - changed[3:5, 4:12]
    assert copies([(photo(1), shot), (photo(2), changed)]) == {1: None, 2: None}


def test_gallery_shows_the_largest_copy_at_the_first_place_and_drops_small_photos():
    photos = [
        photo(10, 600, 600, duplicate_of=13),  # the main photo, also uploaded in a larger size
        photo(11, 300, 300),  # small secondary photo
        photo(12, None, None),  # not processed yet
        photo(13, 1200, 1200),
        photo(14, 900, 700),
    ]
    assert [p.id for p in gallery(photos, min_side=400)] == [13, 12, 14]
    assert [p.id for p in gallery(photos, min_side=0)] == [13, 11, 12, 14]
    assert [p.id for p in gallery(photos, min_side=400, dedupe=False)] == [10, 12, 13, 14]

    # the first photo stays even when small, and a copy whose larger version is gone is shown itself
    alone = [photo(20, 300, 300), photo(21, 800, 800, duplicate_of=99)]
    assert [p.id for p in gallery(alone, min_side=400)] == [20, 21]
