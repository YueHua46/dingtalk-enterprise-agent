"""Scoped, bounded aggregation of daily product facts for Agent analysis."""

from __future__ import annotations

import json
from datetime import timedelta

from database.database import Database
from database.table_names import T_DAILY_PRODUCT_ANALYSIS_VIEW
from domain.competitor.marketplace import _MARKET_TO_AMAZON, canonical_amazon_marketplace
from services.daily_data_availability import default_daily_end_date


def aggregate_daily(sids: list[int], params: dict) -> dict:
    from api.agent_access_routes import _parse_query_date

    dimensions = params.get("dimensions") or ["store", "site", "asin"]
    if not isinstance(dimensions, list) or not dimensions or any(not isinstance(item, str) for item in dimensions) or len(set(dimensions)) != len(dimensions) or not set(dimensions).issubset({"store", "site", "asin"}):
        raise ValueError("dimensions 必须由 store/site/asin 构成且不得重复")
    measures = params.get("measures") or ["units", "revenue"]
    if not isinstance(measures, list) or not measures or any(not isinstance(item, str) for item in measures) or len(set(measures)) != len(measures) or not set(measures).issubset({"units", "revenue"}):
        raise ValueError("measures 仅支持 units/revenue")
    order_by = str(params.get("order_by") or "units").lower()
    order = str(params.get("order") or "desc").lower()
    if order_by not in measures or order not in {"asc", "desc"}:
        raise ValueError("order_by 必须属于 measures，order 必须为 asc/desc")
    site = str(params.get("site") or "").strip() or None
    asin = str(params.get("asin") or "").strip().upper() or None
    if site is not None and len(site) > 80 or asin is not None and len(asin) > 20:
        raise ValueError("site 或 asin 过滤条件过长")
    if site in {"EU", "欧洲"}:
        raise ValueError("EU 为多站点区域，请指定实际国家站点")
    site = canonical_amazon_marketplace(site) or site
    if order_by == "revenue" and site is None:
        raise ValueError("跨站点币种不可直接按销售额排序，请限定 site")
    limit = int(params.get("limit") or 30)
    offset = int(params.get("offset") or 0)
    if limit < 1 or limit > 100 or offset < 0 or offset > 10000:
        raise ValueError("limit 或 offset 超出允许范围")

    db = Database()
    end = _parse_query_date(params.get("end_date"), default_daily_end_date(db, allowed_lingxing_sids=set(sids)))
    start = _parse_query_date(params.get("start_date"), end - timedelta(days=6))
    days = (end - start).days + 1
    if days < 1 or days > 30:
        raise ValueError("查询期间必须为 1 到 30 天")
    by_store = "store" in dimensions
    by_site = "site" in dimensions
    by_asin = "asin" in dimensions
    order_column = {"units": "units", "revenue": "revenue"}[order_by]
    order_direction = {"asc": "ASC", "desc": "DESC"}[order]
    # Normalize source aliases before grouping. A country name and its country
    # code describe the same marketplace; broad regions remain distinct.
    site_aliases = json.dumps({key: value for key, value in _MARKET_TO_AMAZON.items()
                               if key not in {"EU", "欧洲"}}, ensure_ascii=False)
    sql = f"""
        WITH normalized AS (
          SELECT analysis.lingxing_sid,
            COALESCE(%s::jsonb ->> analysis.category, upper(analysis.category)) AS site,
            upper(analysis.asin) AS asin, analysis.daily_sales, analysis.daily_revenue,
            analysis.analysis_date, analysis.source_type, analysis.raw_payload
          FROM {T_DAILY_PRODUCT_ANALYSIS_VIEW} analysis
          WHERE analysis.status='active' AND analysis.lingxing_sid = ANY(%s)
            AND analysis.source_type <> 'snapshot'
            AND analysis.analysis_date BETWEEN %s AND %s
            AND analysis.asin IS NOT NULL
        ), base AS (
          SELECT normalized.lingxing_sid, normalized.site, normalized.asin,
            SUM(COALESCE(normalized.daily_sales, 0)) AS units,
            SUM(COALESCE(normalized.daily_revenue, 0)) AS revenue,
            COUNT(DISTINCT normalized.analysis_date) AS observed_days,
            BOOL_AND(normalized.daily_sales IS NOT NULL AND normalized.daily_revenue IS NOT NULL
              AND COALESCE(NULLIF(normalized.raw_payload ->> 'business_complete', '')::boolean, TRUE)) AS business_complete
          FROM normalized
          WHERE (%s IS NULL OR normalized.site = %s)
            AND (%s IS NULL OR normalized.asin = %s)
          GROUP BY normalized.lingxing_sid, normalized.site, normalized.asin
        ), grouped AS (
          SELECT CASE WHEN %s THEN base.lingxing_sid ELSE NULL END AS lingxing_sid,
            CASE WHEN %s THEN base.site ELSE NULL END AS site,
            CASE WHEN %s THEN base.asin ELSE NULL END AS asin,
            SUM(base.units) AS units, SUM(base.revenue) AS revenue,
            COUNT(*) AS constituent_count,
            COUNT(*) FILTER (WHERE base.observed_days <> %s OR NOT COALESCE(base.business_complete, FALSE)) AS incomplete_constituent_count
          FROM base
          GROUP BY CASE WHEN %s THEN base.lingxing_sid ELSE NULL END,
            CASE WHEN %s THEN base.site ELSE NULL END,
            CASE WHEN %s THEN base.asin ELSE NULL END
        ), coverage AS (
          SELECT COUNT(*) AS candidate_count,
            COUNT(*) FILTER (WHERE incomplete_constituent_count = 0) AS complete_count
          FROM grouped
        ), page AS (
          SELECT grouped.*, store.name AS store_name, store.country AS store_country,
            COUNT(*) OVER (PARTITION BY grouped.{order_column}) AS tie_count
          FROM grouped LEFT JOIN cbops_sys_store_catalog store ON store.lingxing_sid=grouped.lingxing_sid
          WHERE grouped.incomplete_constituent_count = 0
          ORDER BY grouped.{order_column} {order_direction}, grouped.lingxing_sid, grouped.site, grouped.asin
          LIMIT %s OFFSET %s
        )
        SELECT page.*, coverage.candidate_count, coverage.complete_count
        FROM coverage LEFT JOIN page ON TRUE
    """
    rows = db.daily_product_analysis.fetch_all(sql, (site_aliases, sorted(set(sids)), start, end, site, site, asin, asin,
        by_store, by_site, by_asin, days, by_store, by_site, by_asin, limit, offset))
    result_rows = []
    for raw in rows:
        row = dict(raw)
        if row.get("constituent_count") is None:
            continue
        marketplace = canonical_amazon_marketplace(str(row.get("site") or ""))
        currency = {
            "US": "USD", "CA": "CAD", "MX": "MXN", "BR": "BRL", "JP": "JPY",
            "UK": "GBP", "GB": "GBP", "DE": "EUR", "FR": "EUR", "IT": "EUR", "ES": "EUR", "NL": "EUR", "BE": "EUR",
            "SE": "SEK", "PL": "PLN", "AU": "AUD", "SG": "SGD", "AE": "AED", "SA": "SAR",
        }.get(marketplace)
        result_rows.append({
            "lingxing_sid": int(row["lingxing_sid"]) if row.get("lingxing_sid") is not None else None, "store_name": row.get("store_name"),
            "store_country": row.get("store_country"), "site": row["site"], "currency": currency,
            "asin": row["asin"], "units": int(row["units"]),
            "revenue": float(row["revenue"]) if by_site or site is not None else None,
            "constituent_count": int(row["constituent_count"]), "business_complete": True,
            "tie_count": int(row.get("tie_count") or 1),
        })
    candidates = int(rows[0]["candidate_count"]) if rows else 0
    complete = int(rows[0]["complete_count"]) if rows else 0
    return {
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "dimensions": dimensions, "measures": measures, "order_by": order_by, "order": order,
        "filters": {"site": site, "asin": asin},
        "rows": result_rows, "total": complete, "limit": limit, "offset": offset,
        "coverage": {"candidate_count": candidates, "complete_count": complete, "excluded_incomplete_count": candidates - complete},
        "coverage_rule": "business rows only (snapshot rows excluded); every store-site-ASIN constituent requires one complete business row per day; entities absent from source data cannot be ranked",
        "currency_note": "revenue is in each store-site local currency; never aggregate across currencies",
    }
