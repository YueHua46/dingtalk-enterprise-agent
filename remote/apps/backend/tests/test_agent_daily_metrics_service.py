"""Unit tests for the Agent daily metrics query (database stubbed)."""

from __future__ import annotations

import sys
import types
import unittest
from datetime import date, datetime
from pathlib import Path

CAPTURED: dict = {}
ROWS: list = []


class _Repo:
    def fetch_all(self, sql, args):
        if "cbops_sys_store_catalog" in sql:
            return [{"lingxing_sid": 44, "name": "Flaty-JP", "country": "JP"}]
        CAPTURED["sql"], CAPTURED["args"] = sql, args
        return ROWS


class _Database:
    def __init__(self):
        self.daily_product_analysis = _Repo()


def _stub(name: str, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module


_stub("database")
_stub("database.database", Database=_Database)
_stub("database.table_names", T_DAILY_PRODUCT_ANALYSIS_VIEW="cbops_daily_product_analysis_v")
_stub("domain")
_stub("domain.competitor")
_stub("domain.competitor.marketplace", _MARKET_TO_AMAZON={"日本": "JP", "美国": "US"},
      canonical_amazon_marketplace=lambda value: {"日本": "JP", "JP": "JP", "美国": "US", "US": "US"}.get(value or "", None))
_stub("services", __path__=[str(Path(__file__).resolve().parents[1] / "services")])
_stub("services.daily_data_availability", default_daily_end_date=lambda db, **_: date(2026, 9, 27))
_stub("api")
_stub("api.agent_access_routes", _parse_query_date=lambda value, fallback: datetime.strptime(str(value)[:10], "%Y-%m-%d").date() if value else fallback)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.agent_daily_metrics_service import daily_metrics  # noqa: E402


def row(**values):
    base = {"constituents": 1, "business_rows": 7, "business_days": 7, "incomplete_rows": 0, "any_site": "JP", "site_count": 1,
            "base_constituents": 1, "base_business_rows": 7, "base_incomplete_rows": 0}
    base.update(values)
    return base


class DailyMetricsTest(unittest.TestCase):
    def setUp(self):
        ROWS.clear()
        CAPTURED.clear()

    def test_placeholders_match_arguments_for_every_shape(self):
        for params in ({}, {"compare": "previous_period", "dimensions": ["asin"], "site": "JP", "asins": ["b0a"]},
                       {"dimensions": ["date"], "measures": ["units", "price", "inventory"]}, {"compare": {"start_date": "2025-09-21", "end_date": "2025-09-27"}}):
            daily_metrics([44], params)
            self.assertEqual(CAPTURED["sql"].count("%s"), len(CAPTURED["args"]), params)
            self.assertIn("source_type <> 'snapshot'", CAPTURED["sql"])

    def test_site_totals_ratios_and_completeness(self):
        ROWS.extend([
            row(dim_asin="B01", cur_units=12, cur_revenue=89625, cur_sessions=132, cur_ad_spend=1696.26, cur_ad_sales=30000),
            row(dim_asin="B02", cur_units=23, cur_revenue=159370, cur_sessions=292, business_rows=6),
        ])
        result = daily_metrics([44], {"start_date": "2026-09-21", "end_date": "2026-09-27", "site": "JP", "dimensions": ["asin"],
                                      "measures": ["units", "revenue", "cvr", "aov", "acos"]})
        first = result["rows"][0]
        self.assertEqual(first["asin"], "B02")
        self.assertEqual(first["currency"], "JPY")
        self.assertFalse(first["coverage"]["complete"])
        self.assertAlmostEqual(result["rows"][1]["metrics"]["cvr"], 12 / 132, places=5)
        totals = result["totals_by_site"][0]
        self.assertEqual(totals["metrics"]["units"], 35)
        self.assertEqual(totals["metrics"]["revenue"], 248995)
        self.assertAlmostEqual(totals["metrics"]["cvr"], 35 / 424, places=5)
        self.assertEqual(totals["incomplete_groups"], 1)
        self.assertNotIn("_sums", first)

    def test_money_is_null_across_currencies_and_cannot_be_ranked(self):
        ROWS.append(row(dim_asin="B01", cur_units=5, cur_revenue=100, any_site="JP", site_count=2))
        result = daily_metrics([44], {"dimensions": ["asin"], "measures": ["units", "revenue", "aov"]})
        self.assertIsNone(result["rows"][0]["metrics"]["revenue"])
        self.assertIsNone(result["rows"][0]["metrics"]["aov"])
        self.assertEqual(result["rows"][0]["metrics"]["units"], 5)
        with self.assertRaises(ValueError):
            daily_metrics([44], {"dimensions": ["asin"], "measures": ["revenue"], "order_by": "revenue"})

    def test_compare_reports_baseline_and_change_and_orders_by_change(self):
        ROWS.extend([
            row(dim_asin="B01", cur_units=12, base_units=23, cur_sessions=132, base_sessions=165),
            row(dim_asin="B02", cur_units=23, base_units=30, cur_sessions=292, base_sessions=249),
        ])
        result = daily_metrics([44], {"site": "JP", "dimensions": ["asin"], "compare": "previous_period", "measures": ["units", "sessions", "cvr"],
                                      "order_by": "units_change", "order": "asc"})
        self.assertEqual(result["baseline_period"], {"start_date": "2026-09-14", "end_date": "2026-09-20"})
        self.assertEqual(result["rows"][0]["asin"], "B01")
        self.assertEqual(result["rows"][0]["change"]["units"], {"abs": -11, "pct": round(-11 / 23, 6)})
        self.assertAlmostEqual(result["rows"][0]["baseline"]["cvr"], 23 / 165, places=5)
        self.assertTrue(result["rows"][0]["coverage"]["baseline_complete"])

    def test_rejects_invalid_requests(self):
        for params in ({"dimensions": ["country"]}, {"measures": ["profit"]}, {"dimensions": ["date"], "compare": "previous_period"},
                       {"start_date": "2026-01-01", "end_date": "2026-09-27"}, {"site": "EU"}, {"order_by": "units_change"}):
            with self.assertRaises(ValueError, msg=str(params)):
                daily_metrics([44], params)

    def test_store_dimension_names_the_store(self):
        ROWS.append(row(dim_store=44, cur_units=3, cur_revenue=900))
        result = daily_metrics([44], {"dimensions": ["store"], "measures": ["units", "revenue"]})
        self.assertEqual(result["rows"][0]["store_name"], "Flaty-JP")
        self.assertEqual(result["rows"][0]["metrics"]["revenue"], 900)


if __name__ == "__main__":
    unittest.main()
