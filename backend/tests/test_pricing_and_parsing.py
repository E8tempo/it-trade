from datetime import UTC, datetime
from decimal import Decimal

from app.models import Audience, PaymentMethod, PriceType, Product
from app.models.catalog import PRICE_COLUMNS, price_type
from app.pricing import PriceRules, SupplierPricing, compute_prices, price_breakdown
from app.sync.categories import flatten_tree
from app.sync.common import slugify
from app.sync.products import product_row


def price(supplier_price: Decimal, rrp: Decimal | None, path: str | None, s: PriceRules) -> Decimal:
    return price_breakdown(supplier_price, rrp, path, s).price


def test_price_markup_and_rounding():
    s = PriceRules(markup_percent=Decimal(20), round_to=10, use_rrp=False)
    assert price(Decimal("1000"), None, None, s) == Decimal("1200.00")
    assert price(Decimal("1001"), None, None, s) == Decimal("1210.00")  # rounded up


def test_price_category_override_is_inherited():
    s = PriceRules(markup_percent=Decimal(20), category_markups={10: Decimal(50)}, round_to=1, use_rrp=False)
    assert price(Decimal("100"), None, "/10/20/30/", s) == Decimal("150.00")
    assert price(Decimal("100"), None, "/11/20/", s) == Decimal("120.00")


def test_price_min_markup_and_rrp():
    s = PriceRules(markup_percent=Decimal(5), min_markup=Decimal(100), round_to=1, use_rrp=True)
    assert price(Decimal("200"), None, None, s) == Decimal("300.00")  # min markup wins
    assert price(Decimal("200"), Decimal("450"), None, s) == Decimal("450.00")  # rrp used
    assert price(Decimal("200"), Decimal("250"), None, s) == Decimal("300.00")  # rrp below min markup ignored


def test_price_types():
    assert price_type(Audience.wholesale, PaymentMethod.cashless) is PriceType.wholesale_cashless
    assert [(t.audience, t.payment) for t in PriceType] == [
        ("retail", "cash"), ("retail", "cashless"), ("wholesale", "cash"), ("wholesale", "cashless"),
    ]
    assert PRICE_COLUMNS[PriceType.retail_cash] == "price"  # the shop price of listings, filters and sorting
    p = Product(price=Decimal(10), price_retail_cashless=Decimal(11), price_overrides={})
    assert p.price_overrides is None  # no fixed prices: NULL, not {}
    assert (p.price_for(PriceType.retail_cash), p.price_for("retail_cashless"), p.price_for(PriceType.wholesale_cash)) == (10, 11, None)
    p.price_overrides = {"wholesale_cash": "9.50"}
    assert p.fixed_prices() == {PriceType.wholesale_cash: Decimal("9.50")}


# each type by its own rules: markups (default and per category), minimal markup, rounding, RRP
PRICING = SupplierPricing(
    retail_cash=PriceRules(markup_percent=Decimal(20), round_to=10, use_rrp=True),
    retail_cashless=PriceRules(markup_percent=Decimal(25), category_markups={10: Decimal(30)}, round_to=1, use_rrp=True),
    wholesale_cash=PriceRules(markup_percent=Decimal(5), min_markup=Decimal(100), round_to=50, use_rrp=False),
    wholesale_cashless=PriceRules(markup_percent=Decimal(8), category_markups={20: Decimal(12)}, round_to=1, use_rrp=False),
)


def test_compute_prices_by_the_rules_of_each_type():
    assert SupplierPricing().rules(PriceType.wholesale_cash) == PriceRules()  # defaults for every type
    assert compute_prices(Decimal("1001"), None, "/10/20/", PRICING, None) == {
        "price": Decimal("1210.00"),  # 1201.2 rounded up to 10
        "price_retail_cashless": Decimal("1302.00"),  # category 10: 30% -> 1301.3, rounded up to 1
        "price_wholesale_cash": Decimal("1150.00"),  # 5% is 1051.05, the minimal markup gives 1101 -> rounded to 50
        "price_wholesale_cashless": Decimal("1122.00"),  # the nearest category (20): 12% -> 1121.12
    }
    # the RRP is used only by the types that want it, and only above the minimal markup
    prices = compute_prices(Decimal("1000"), Decimal("1500"), None, PRICING, None)
    assert prices["price"] == prices["price_retail_cashless"] == Decimal("1500.00")
    assert (prices["price_wholesale_cash"], prices["price_wholesale_cashless"]) == (Decimal("1100.00"), Decimal("1080.00"))


def test_compute_prices_fixed_price_of_a_type_wins():
    prices = compute_prices(Decimal("1000"), None, None, PRICING, {"wholesale_cash": "777.00", "retail_cash": "1999.99"})
    assert prices == {
        "price": Decimal("1999.99"),
        "price_retail_cashless": Decimal("1250.00"),
        "price_wholesale_cash": Decimal("777.00"),
        "price_wholesale_cashless": Decimal("1080.00"),
    }
    # without a supplier price only the fixed prices are known
    assert compute_prices(None, None, None, PRICING, {"retail_cashless": "50"}) == {
        "price": None, "price_retail_cashless": Decimal("50"), "price_wholesale_cash": None, "price_wholesale_cashless": None,
    }


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


def test_spread_sample_takes_turns_between_root_categories():
    from app.sync.products import spread_sample

    def entry(sku, in_stock=True):
        return ((in_stock, sku), {"sku": sku})

    # root 1 has three categories, root 2 one category with three products
    sample = {
        11: [entry(110), entry(111, in_stock=False)],
        12: [entry(120)],
        13: [entry(130, in_stock=False)],
        21: [entry(210), entry(211), entry(212)],
    }
    root_of = {11: 1, 12: 1, 13: 1, 21: 2}
    picked = [r["sku"] for r in spread_sample(sample, root_of, 4)]
    # roots alternate; inside a root: categories with in-stock products first, one product each first
    assert picked == [120, 212, 110, 211]
    everything = [r["sku"] for r in spread_sample(sample, root_of, 100)]
    assert sorted(everything) == [110, 111, 120, 130, 210, 211, 212]
    assert everything[-1] in (111, 130)  # out-of-stock products come last
