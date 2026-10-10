from datetime import UTC, datetime
from decimal import Decimal

from app.site_settings import PricingSettings, retail_price
from app.sync.categories import flatten_tree
from app.sync.common import slugify
from app.sync.products import product_row


def test_retail_price_markup_and_rounding():
    s = PricingSettings(markup_percent=Decimal(20), round_to=10, use_rrp=False)
    assert retail_price(Decimal("1000"), None, None, s) == Decimal("1200.00")
    assert retail_price(Decimal("1001"), None, None, s) == Decimal("1210.00")  # rounded up


def test_retail_price_category_override_is_inherited():
    s = PricingSettings(markup_percent=Decimal(20), category_markups={10: Decimal(50)}, round_to=1, use_rrp=False)
    assert retail_price(Decimal("100"), None, "/10/20/30/", s) == Decimal("150.00")
    assert retail_price(Decimal("100"), None, "/11/20/", s) == Decimal("120.00")


def test_retail_price_min_markup_and_rrp():
    s = PricingSettings(markup_percent=Decimal(5), min_markup=Decimal(100), round_to=1, use_rrp=True)
    assert retail_price(Decimal("200"), None, None, s) == Decimal("300.00")  # min markup wins
    assert retail_price(Decimal("200"), Decimal("450"), None, s) == Decimal("450.00")  # rrp used
    assert retail_price(Decimal("200"), Decimal("250"), None, s) == Decimal("300.00")  # rrp below min markup ignored


def test_flatten_tree_paths():
    rows = flatten_tree([{"id": 1, "name": "Компьютеры", "childrens": [{"id": 2, "name": "Ноутбуки", "leaf": True}]}])
    assert [(r["id"], r["parent_id"], r["path"], r["depth"]) for r in rows] == [(1, None, "/1/", 0), (2, 1, "/1/2/", 1)]
    assert rows[1]["slug"] == "noutbuki"


def test_product_row_from_supplier_json():
    now = datetime.now(UTC)
    raw = {
        "barcodes": "4680011240549", "category": 747, "name": "Ролик захвата HP LJ P2015 (RL1-1525)", "part": "RL1-1525",
        "multiplicity": 0, "sku": 2881306, "vendor": "Hewlett-Packard", "volume": 0.000105, "has_image": True,
        "rrp": 5000, "warranty": "12", "weight": 0.02,
    }
    row = product_row(raw, {747}, now)
    assert row["sku"] == 2881306 and row["category_id"] == 747
    assert row["multiplicity"] == 1 and row["warranty_months"] == 12 and row["rrp"] == Decimal("5000.00")
    assert "rl1-1525" in row["search_text"] and "ролик" in row["search_text"]
    assert product_row(raw, set(), now)["category_id"] is None  # unknown category
    assert product_row({"sku": 1}, set(), now) is None  # no name


def test_slugify():
    assert slugify("Кресла детские, автомобильные!") == "kresla-detskie-avtomobilnye"
    assert slugify("!!!") == "item"
