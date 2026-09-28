from datetime import date
from types import SimpleNamespace

import pytest

import services.agent_daily_aggregate_service as aggregate_module


def test_aggregate_daily_keeps_user_scope_period_and_sort(monkeypatch):
    calls = []

    def fetch_all(sql, args):
        calls.append((sql, args))
        return [{
            "lingxing_sid": 44, "site": "JP", "asin": "B000000001",
            "store_name": "Shop", "store_country": "JP", "units": 2,
            "revenue": 1000, "constituent_count": 1,
            "candidate_count": 12, "complete_count": 9, "tie_count": 3,
        }]

    monkeypatch.setattr(aggregate_module, "Database", lambda: SimpleNamespace(daily_product_analysis=SimpleNamespace(fetch_all=fetch_all)))
    monkeypatch.setattr(aggregate_module, "default_daily_end_date", lambda *_args, **_kwargs: date(2026, 9, 24))
    result = aggregate_module.aggregate_daily([44, 44], {
        "start_date": "2026-09-14", "end_date": "2026-09-20",
        "dimensions": ["store", "site", "asin"], "measures": ["units"],
        "order_by": "units", "order": "asc", "limit": 5,
    })
    sql, args = calls[0]
    assert "ORDER BY grouped.units ASC" in sql
    assert "COALESCE(%s::jsonb ->> analysis.category" in sql
    assert '"西班牙": "ES"' in args[0]
    assert args[1] == [44]
    assert args[2:4] == (date(2026, 9, 14), date(2026, 9, 20))
    assert result["period"] == {"start_date": "2026-09-14", "end_date": "2026-09-20"}
    assert result["rows"][0]["units"] == 2
    assert result["rows"][0]["tie_count"] == 3
    assert result["coverage"]["excluded_incomplete_count"] == 3
    assert result["population_provenance"]["absent_authorized_entities"] == "unknown_not_zero"
    assert result["population_provenance"]["full_authorized_population_verified"] is False


@pytest.mark.parametrize("params", [
    {"order": "drop table"},
    {"order_by": "price"},
    {"dimensions": ["unknown"]},
    {"measures": ["profit"]},
    {"measures": ["revenue"], "order_by": "revenue"},
    {"site": "EU"},
    {"start_date": "2026-01-01", "end_date": "2026-09-20"},
])
def test_aggregate_daily_rejects_invalid_query_shapes(monkeypatch, params):
    monkeypatch.setattr(aggregate_module, "Database", lambda: SimpleNamespace(daily_product_analysis=SimpleNamespace(fetch_all=lambda *_: [])))
    monkeypatch.setattr(aggregate_module, "default_daily_end_date", lambda *_args, **_kwargs: date(2026, 9, 24))
    with pytest.raises(ValueError):
        aggregate_module.aggregate_daily([44], params)


def test_aggregate_daily_can_group_across_stores_without_mixing_revenue(monkeypatch):
    def fetch_all(sql, args):
        assert args[8:11] == (False, False, True)
        return [{"lingxing_sid": None, "site": None, "asin": "B000000001", "units": 15,
                 "revenue": 999, "constituent_count": 3, "candidate_count": 8,
                 "complete_count": 7, "tie_count": 1}]

    monkeypatch.setattr(aggregate_module, "Database", lambda: SimpleNamespace(daily_product_analysis=SimpleNamespace(fetch_all=fetch_all)))
    monkeypatch.setattr(aggregate_module, "default_daily_end_date", lambda *_args, **_kwargs: date(2026, 9, 24))
    result = aggregate_module.aggregate_daily([44, 55], {"dimensions": ["asin"], "measures": ["units"], "order_by": "units"})
    assert result["rows"][0]["units"] == 15
    assert result["rows"][0]["revenue"] is None
    assert result["rows"][0]["constituent_count"] == 3
