from datetime import date
from types import SimpleNamespace
import pytest
from services.agent_ads_metrics_service import ads_metrics, metrics
from api.agent_access_routes import _query_sids, _ads_query


def test_site_filters_within_employee_scope_and_never_hides_unauthorized_sid():
    scope = {"lingxing_sids": [1, 2, 3], "stores": [
        {"lingxing_sid": 1, "country": "日本"}, {"lingxing_sid": 2, "country": "德国"}, {"lingxing_sid": 3, "country": "美国"}]}
    assert _query_sids(scope, {"site": "DE"}) == [2]
    assert _query_sids(scope, {"site": "US", "store_sids": [2, 3]}) == [3]
    with pytest.raises(PermissionError):
        _query_sids(scope, {"site": "DE", "store_sids": [999]})


def test_advertising_days_are_applied_and_unknown_filters_are_rejected(monkeypatch):
    import database.database as database_module
    import services.daily_data_availability as availability_module
    calls = []
    def summary(**kwargs):
        calls.append(kwargs)
        return []
    db = SimpleNamespace(ad_reports=SimpleNamespace(daily_summary_sp=summary, daily_summary_sb=summary, daily_summary_sp_placements=summary))
    monkeypatch.setattr(database_module, "Database", lambda: db)
    monkeypatch.setattr(availability_module, "default_daily_end_date", lambda *_args, **_kwargs: date(2026, 10, 12))
    result = _ads_query('ads.summary', {"days": 30}, [2])
    assert all(c['start_date'] == date(2026, 9, 13) and c['end_date'] == date(2026, 10, 12) for c in calls)
    assert result['period']['start_date'] == '2026-09-13'
    with pytest.raises(ValueError, match='不支持参数'):
        _ads_query('ads.summary', {"asin": "B000000001"}, [2])


def test_aggregation_ranks_complete_groups_and_totals_before_pagination():
    captured = []
    def fetch(sql, params):
        captured.append((sql, params))
        return [{"sid": 2, "campaign_id": str(i), "spend": spend, "sales": 0, "orders": 0, "clicks": 10, "impressions": 100}
                for i, spend in enumerate([20, 200, 100])]
    db = SimpleNamespace(ad_reports=SimpleNamespace(_fetch_dicts=fetch))
    result = ads_metrics(db, [2], {"sources": ["sp_search_terms"], "dimensions": ["campaign"], "limit": 1}, date(2026, 10, 6), date(2026, 10, 12))
    assert result['rows'][0]['spend'] == 200
    assert result['rows'][0]['acos'] is None
    assert result['totals_by_store_report'][0]['spend'] == 320
    assert result['coverage']['total'] == 3
    assert result['coverage']['has_more'] is True
    assert 'GROUP BY sid, campaign_id' in captured[0][0]
    assert captured[0][1][0] == [2]


def test_report_families_and_identity_filters_are_not_silently_mixed():
    db = SimpleNamespace(ad_reports=None)
    with pytest.raises(ValueError, match='不支持所选维度'):
        ads_metrics(db, [2], {"sources": ["placements"], "dimensions": ["asin"]}, date(2026, 10, 6), date(2026, 10, 12))
    assert metrics({"spend": 10, "sales": 0, "clicks": 0, "orders": 0, "impressions": 0})['cpc'] is None


def test_dimension_coverage_preserves_missing_search_terms_across_all_groups():
    rows = [{"sid": 2, "campaign_id": "c", "ad_group_id": "g", "keyword_text": str(i),
             "match_type": "BROAD", "customer_search_term": term, "spend": 10,
             "sales": 0, "orders": 0, "clicks": 2, "impressions": 30}
            for i, term in enumerate([None, "", "actual query"])]
    db = SimpleNamespace(ad_reports=SimpleNamespace(_fetch_dicts=lambda *_args: rows))
    result = ads_metrics(db, [2], {"sources": ["sp_search_terms"], "dimensions": ["search_term"], "limit": 1}, date(2026, 10, 6), date(2026, 10, 12))
    assert result['dimension_field_coverage']['fields']['customer_search_term'] == {"groups_with_value": 1, "groups_missing_value": 2}
    assert result['semantics']['dimension_fields']['asin'] == 'advertised_product_asin_not_targeted_asin'
