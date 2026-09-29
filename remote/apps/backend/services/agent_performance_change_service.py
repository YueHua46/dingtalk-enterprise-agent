"""Bounded, scope-filtered store/ASIN sales-change discovery for the Agent."""

from __future__ import annotations

from datetime import timedelta

from database.database import Database
from database.table_names import T_DAILY_PRODUCT_ANALYSIS_VIEW
from domain.competitor.marketplace import canonical_amazon_marketplace
from services.daily_data_availability import default_daily_end_date


def performance_changes(sids: list[int], params: dict) -> dict:
    from api.agent_access_routes import _parse_query_date

    grain = str(params.get("grain") or "asin").strip().lower()
    direction = str(params.get("direction") or "decline").strip().lower()
    if grain not in {"asin", "store"} or direction not in {"decline", "growth", "all"}:
        raise ValueError("grain 必须为 asin/store，direction 必须为 decline/growth/all")
    change_condition = {
        "decline": "current_units < baseline_units",
        "growth": "current_units > baseline_units",
        "all": "TRUE",
    }[direction]
    days = int(params.get("days") or 7)
    if days < 1 or days > 30:
        raise ValueError("days 必须介于 1 和 30")
    limit = int(params.get("limit") or 30)
    offset = int(params.get("offset") or 0)
    if limit < 1 or limit > 100 or offset < 0 or offset > 10000:
        raise ValueError("limit 或 offset 超出允许范围")
    db = Database()
    end = _parse_query_date(params.get("end_date"), default_daily_end_date(db, allowed_lingxing_sids=set(sids)))
    current_start = end - timedelta(days=days - 1)
    baseline_end = current_start - timedelta(days=1)
    baseline_start = baseline_end - timedelta(days=days - 1)
    sql = f"""
        WITH compared AS (
            SELECT analysis.lingxing_sid, analysis.category AS site,
              CASE WHEN %s = 'store' THEN NULL ELSE upper(analysis.asin) END AS asin,
              SUM(COALESCE(analysis.daily_sales, 0)) FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS current_units,
              SUM(COALESCE(analysis.daily_sales, 0)) FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS baseline_units,
              SUM(COALESCE(analysis.daily_revenue, 0)) FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS current_revenue,
              SUM(COALESCE(analysis.daily_revenue, 0)) FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS baseline_revenue,
              COUNT(DISTINCT analysis.analysis_date) FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS current_days,
              COUNT(DISTINCT analysis.analysis_date) FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS baseline_days,
              BOOL_AND(analysis.daily_sales IS NOT NULL AND analysis.daily_revenue IS NOT NULL
                AND COALESCE(NULLIF(analysis.raw_payload ->> 'business_complete', '')::boolean, TRUE))
                FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS current_complete,
              BOOL_AND(analysis.daily_sales IS NOT NULL AND analysis.daily_revenue IS NOT NULL
                AND COALESCE(NULLIF(analysis.raw_payload ->> 'business_complete', '')::boolean, TRUE))
                FILTER (WHERE analysis.analysis_date BETWEEN %s AND %s) AS baseline_complete
            FROM {T_DAILY_PRODUCT_ANALYSIS_VIEW} analysis
            WHERE analysis.status='active' AND analysis.lingxing_sid = ANY(%s)
              AND analysis.source_type <> 'snapshot'
              AND analysis.analysis_date BETWEEN %s AND %s
              AND (%s = 'store' OR analysis.asin IS NOT NULL)
            GROUP BY analysis.lingxing_sid, analysis.category,
              CASE WHEN %s = 'store' THEN NULL ELSE upper(analysis.asin) END
        ), coverage AS (
          SELECT COUNT(*) AS candidate_count,
            COUNT(*) FILTER (WHERE current_days = %s AND baseline_days = %s
              AND current_complete AND baseline_complete) AS comparable_count,
            COUNT(*) FILTER (WHERE current_days = %s AND baseline_days = %s
              AND current_complete AND baseline_complete AND baseline_units = 0) AS zero_baseline_count,
            COUNT(*) FILTER (WHERE current_days = %s AND baseline_days = %s
              AND current_complete AND baseline_complete AND baseline_units > 0
              AND {change_condition}) AS selected_count
          FROM compared
        ), eligible AS (
          SELECT *, current_units - baseline_units AS unit_change,
            current_revenue - baseline_revenue AS revenue_change
          FROM compared
          WHERE baseline_units > 0 AND {change_condition}
            AND current_days = %s AND baseline_days = %s
            AND current_complete AND baseline_complete
        ), page AS (
          SELECT eligible.*, store.name AS store_name, store.country AS store_country
          FROM eligible
          LEFT JOIN cbops_sys_store_catalog store ON store.lingxing_sid=eligible.lingxing_sid
          ORDER BY ABS(unit_change) DESC, eligible.lingxing_sid, eligible.asin
          LIMIT %s OFFSET %s
        )
        SELECT page.*, coverage.candidate_count, coverage.comparable_count,
          coverage.zero_baseline_count, coverage.selected_count
        FROM coverage LEFT JOIN page ON TRUE
    """
    args = (
        grain,
        current_start, end, baseline_start, baseline_end,
        current_start, end, baseline_start, baseline_end,
        current_start, end, baseline_start, baseline_end,
        current_start, end, baseline_start, baseline_end,
        sorted(set(sids)), baseline_start, end, grain, grain,
        days, days, days, days, days, days,
        days, days, limit, offset,
    )
    rows = db.daily_product_analysis.fetch_all(sql, args)
    items = []
    for raw in rows:
        row = dict(raw)
        if row.get("lingxing_sid") is None:
            continue
        marketplace = canonical_amazon_marketplace(str(row.get("site") or ""))
        currency = {
            "US": "USD", "CA": "CAD", "MX": "MXN", "BR": "BRL", "JP": "JPY",
            "UK": "GBP", "GB": "GBP", "DE": "EUR", "FR": "EUR", "IT": "EUR", "ES": "EUR", "NL": "EUR",
            "SE": "SEK", "PL": "PLN", "AU": "AUD", "SG": "SGD", "AE": "AED", "SA": "SAR",
        }.get(marketplace)
        items.append({
            "lingxing_sid": int(row["lingxing_sid"]), "store_name": row.get("store_name"),
            "store_country": row.get("store_country"), "site": row["site"], "currency": currency, "asin": row["asin"],
            "current_units": int(row["current_units"]), "baseline_units": int(row["baseline_units"]),
            "unit_change": int(row["unit_change"]),
            "unit_drop": max(0, -int(row["unit_change"])),
            "unit_gain": max(0, int(row["unit_change"])),
            "current_revenue": float(row["current_revenue"]), "baseline_revenue": float(row["baseline_revenue"]),
            "revenue_change": float(row["revenue_change"]),
            "revenue_drop": max(0.0, -float(row["revenue_change"])),
            "revenue_gain": max(0.0, float(row["revenue_change"])),
            "current_days": int(row["current_days"]), "baseline_days": int(row["baseline_days"]),
            "business_complete": True,
        })
    return {
        "current_period": {"start_date": current_start.isoformat(), "end_date": end.isoformat()},
        "baseline_period": {"start_date": baseline_start.isoformat(), "end_date": baseline_end.isoformat()},
        "metric": "daily_sales", "grain": grain, "direction": direction,
        "ranking": "absolute_unit_change_desc", "currency_note": "revenue is store-site local currency; do not aggregate across sites",
        "rows": items, "total": int(rows[0]["selected_count"]) if rows else 0,
        "coverage": {
            "candidate_count": int(rows[0]["candidate_count"]) if rows else 0,
            "comparable_count": int(rows[0]["comparable_count"]) if rows else 0,
            "zero_baseline_count": int(rows[0]["zero_baseline_count"]) if rows else 0,
            "excluded_incomplete_count": int(rows[0]["candidate_count"] - rows[0]["comparable_count"]) if rows else 0,
        },
        "limit": limit, "offset": offset,
        "coverage_rule": "business rows only (snapshot rows excluded); both periods require one complete business row per day; incomplete and zero-baseline items are excluded",
    }
