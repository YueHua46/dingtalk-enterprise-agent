"""General-purpose, scope-filtered daily metrics for the Agent.

One call answers "how did these objects perform over this period" at any
grouping: totals, rankings, funnel and advertising diagnostics, and
period-over-period changes. Business measures come only from business rows
(source_type <> 'snapshot'); snapshot rows are detail-page captures that carry
listing state with zero-filled sales and must never be counted as sales or used
to mark a business day incomplete. Incompleteness is reported per row instead
of silently dropping groups.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from database.database import Database
from database.table_names import T_DAILY_PRODUCT_ANALYSIS_VIEW
from domain.competitor.marketplace import _MARKET_TO_AMAZON, canonical_amazon_marketplace
from services.daily_data_availability import default_daily_end_date

CURRENCY_BY_MARKET = {
    "US": "USD", "CA": "CAD", "MX": "MXN", "BR": "BRL", "JP": "JPY",
    "UK": "GBP", "GB": "GBP", "DE": "EUR", "FR": "EUR", "IT": "EUR", "ES": "EUR", "NL": "EUR", "BE": "EUR",
    "SE": "SEK", "PL": "PLN", "AU": "AUD", "SG": "SGD", "AE": "AED", "SA": "SAR", "IE": "EUR", "TR": "TRY", "IN": "INR",
}

# Additive measures: view column, whether the value is money in local currency.
ADDITIVE = {
    "units": ("daily_sales", False),
    "revenue": ("daily_revenue", True),
    "orders": ("order_count", False),
    "sessions": ("sessions", False),
    "page_views": ("page_views", False),
    "ad_spend": ("ad_spend", True),
    "ad_sales": ("ad_sales", True),
    "ad_clicks": ("ad_clicks", False),
    "ad_orders": ("ad_orders", False),
    "non_ad_clicks": ("non_ad_clicks", False),
}
# Ratios are always recomputed from summed numerators and denominators.
DERIVED = {
    "cvr": ("units", "sessions", False),
    "order_cvr": ("orders", "sessions", False),
    "aov": ("revenue", "units", True),
    "acos": ("ad_spend", "ad_sales", False),
    "tacos": ("ad_spend", "revenue", False),
    "cpc": ("ad_spend", "ad_clicks", True),
    "ad_cvr": ("ad_orders", "ad_clicks", False),
    "ad_sales_share": ("ad_sales", "revenue", False),
}
# Listing state: the latest non-empty business-row value in the current period.
LATEST = {
    "price": "price",
    "rating": "rating_score",
    "review_count": "review_count",
    "main_category_rank": "main_category_rank",
    "sub_category_rank": "sub_category_rank",
    "inventory": "inventory_count",
    "buy_box_pct": "buy_box_pct",
}
MONEY_LATEST = {"price"}
DEFAULT_MEASURES = ["units", "revenue", "orders", "sessions", "cvr", "aov", "ad_spend", "ad_sales", "ad_clicks", "acos", "tacos"]
DIMENSIONS = {"store", "site", "asin", "sku", "date"}
MAX_DAYS = 92


def daily_metrics(sids: list[int], params: dict) -> dict:
    from api.agent_access_routes import _parse_query_date

    dimensions = params.get("dimensions") or ["site"]
    if not isinstance(dimensions, list) or not dimensions or len(set(dimensions)) != len(dimensions) or not set(dimensions).issubset(DIMENSIONS):
        raise ValueError("dimensions 必须是 store/site/asin/sku/date 中不重复的组合")
    measures = params.get("measures") or DEFAULT_MEASURES
    known = set(ADDITIVE) | set(DERIVED) | set(LATEST)
    if not isinstance(measures, list) or not measures or any(item not in known for item in measures):
        raise ValueError("measures 仅支持：" + ", ".join(sorted(known)))
    measures = list(dict.fromkeys(measures))

    site = str(params.get("site") or "").strip() or None
    if site in {"EU", "欧洲"}:
        raise ValueError("EU 为多站点区域，请指定实际国家站点")
    site = canonical_amazon_marketplace(site) or site if site else None
    asins = _string_list(params.get("asins", params.get("asin")), "asins", upper=True, limit=200)
    skus = _string_list(params.get("skus", params.get("sku")), "skus", upper=False, limit=200)

    db = Database()
    days_param = int(params.get("days") or 7)
    end = _parse_query_date(params.get("end_date"), default_daily_end_date(db, allowed_lingxing_sids=set(sids)))
    start = _parse_query_date(params.get("start_date"), end - timedelta(days=max(1, days_param) - 1))
    days = (end - start).days + 1
    if days < 1 or days > MAX_DAYS:
        raise ValueError(f"查询期间必须为 1 到 {MAX_DAYS} 天")

    baseline = _baseline(params.get("compare"), start, end, _parse_query_date)
    if baseline and "date" in dimensions:
        raise ValueError("按日期分组时不能同时做两期比较；请去掉 date 维度，或分别查询两个时段")

    order_by = str(params.get("order_by") or ("units" if "units" in measures else measures[0]))
    order_base = order_by[:-7] if order_by.endswith("_change") else order_by
    if order_base not in measures or (order_by.endswith("_change") and not baseline):
        raise ValueError("order_by 必须是本次 measures 之一；带 _change 后缀时需要 compare")
    order = str(params.get("order") or ("asc" if "date" in dimensions and order_by == "date" else "desc")).lower()
    if order not in {"asc", "desc"}:
        raise ValueError("order 必须为 asc/desc")
    currency_known = "site" in dimensions or "store" in dimensions or site is not None
    if _is_money(order_base) and not currency_known:
        raise ValueError("金额类指标跨币种不可排序；请在 dimensions 中包含 site 或 store，或指定 site")
    limit = int(params.get("limit") or 50)
    offset = int(params.get("offset") or 0)
    if limit < 1 or limit > 200 or offset < 0 or offset > 10000:
        raise ValueError("limit 须为 1-200，offset 须为 0-10000")

    group_exprs = {
        "store": "biz.lingxing_sid", "site": "biz.site", "asin": "biz.asin", "sku": "biz.sku", "date": "biz.analysis_date",
    }
    group_cols = [group_exprs[item] for item in dimensions]
    sums = []
    for name, (column, _money) in ADDITIVE.items():
        sums.append(f"SUM(biz.{column}) FILTER (WHERE biz.is_current) AS cur_{name}")
        if baseline:
            sums.append(f"SUM(biz.{column}) FILTER (WHERE biz.is_baseline) AS base_{name}")
    # A zero price is a missing capture; a zero inventory or rank is a real value.
    latest = [f"(ARRAY_AGG(biz.{column} ORDER BY biz.analysis_date DESC) FILTER (WHERE biz.is_current AND biz.{column} IS NOT NULL{' AND biz.' + column + ' > 0' if name == 'price' else ''}))[1] AS latest_{name}"
              for name, column in LATEST.items() if name in measures]
    select_dims = ", ".join(f"{expr} AS dim_{name}" for name, expr in zip(dimensions, group_cols))
    aliases = json.dumps({key: value for key, value in _MARKET_TO_AMAZON.items() if key not in {"EU", "欧洲"}}, ensure_ascii=False)
    base_start, base_end = baseline if baseline else (start, end)
    sql = f"""
        WITH biz AS (
          SELECT analysis.lingxing_sid, COALESCE(%s::jsonb ->> analysis.category, upper(analysis.category)) AS site,
            upper(analysis.asin) AS asin, analysis.sku, analysis.analysis_date,
            analysis.analysis_date BETWEEN %s AND %s AS is_current,
            (%s AND analysis.analysis_date BETWEEN %s AND %s) AS is_baseline,
            {", ".join(sorted({f"analysis.{column}" for column, _ in ADDITIVE.values()} | {f"analysis.{column}" for column in LATEST.values()}))},
            (analysis.daily_sales IS NULL OR analysis.daily_revenue IS NULL
              OR NOT COALESCE(NULLIF(analysis.raw_payload ->> 'business_complete', '')::boolean, TRUE)) AS incomplete
          FROM {T_DAILY_PRODUCT_ANALYSIS_VIEW} analysis
          WHERE analysis.status = 'active' AND analysis.source_type <> 'snapshot'
            AND analysis.lingxing_sid = ANY(%s) AND analysis.asin IS NOT NULL
            AND (analysis.analysis_date BETWEEN %s AND %s OR analysis.analysis_date BETWEEN %s AND %s)
        ), filtered AS (
          SELECT * FROM biz
          WHERE (%s::text IS NULL OR biz.site = %s)
            AND (cardinality(%s::text[]) = 0 OR biz.asin = ANY(%s::text[]))
            AND (cardinality(%s::text[]) = 0 OR biz.sku = ANY(%s::text[]))
            AND (biz.is_current OR biz.is_baseline)
        )
        SELECT {select_dims},
          {", ".join(sums)},
          {", ".join(latest) + "," if latest else ""}
          COUNT(DISTINCT (biz.lingxing_sid, biz.asin)) FILTER (WHERE biz.is_current) AS constituents,
          COUNT(*) FILTER (WHERE biz.is_current) AS business_rows,
          COUNT(DISTINCT biz.analysis_date) FILTER (WHERE biz.is_current) AS business_days,
          COUNT(*) FILTER (WHERE biz.is_current AND biz.incomplete) AS incomplete_rows,
          COUNT(DISTINCT (biz.lingxing_sid, biz.asin)) FILTER (WHERE biz.is_baseline) AS base_constituents,
          COUNT(*) FILTER (WHERE biz.is_baseline) AS base_business_rows,
          COUNT(*) FILTER (WHERE biz.is_baseline AND biz.incomplete) AS base_incomplete_rows,
          MIN(biz.site) AS any_site, COUNT(DISTINCT biz.site) AS site_count
        FROM filtered biz
        GROUP BY {", ".join(group_cols)}
    """
    args = [aliases, start, end, bool(baseline), base_start, base_end, sorted(set(sids)), start, end, base_start, base_end,
            site, site, asins, asins, skus, skus]
    raw_rows = [dict(row) for row in db.daily_product_analysis.fetch_all(sql, tuple(args))]

    stores = _store_catalog(db, sids) if "store" in dimensions else {}
    rows = [_shape_row(raw, dimensions, measures, baseline, days, site, stores) for raw in raw_rows]
    rows = [row for row in rows if row["coverage"]["business_rows"] or (baseline and row["coverage"].get("baseline_business_rows"))]
    rows.sort(key=lambda row: _sort_key(row, order_by, dimensions), reverse=order == "desc")
    totals = _totals(rows, measures, baseline)
    page = [{key: value for key, value in row.items() if not key.startswith("_")} for row in rows[offset:offset + limit]]
    incomplete_groups = sum(1 for row in rows if not row["coverage"]["complete"])
    return {
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat(), "days": days},
        **({"baseline_period": {"start_date": baseline[0].isoformat(), "end_date": baseline[1].isoformat()}} if baseline else {}),
        "dimensions": dimensions, "measures": measures, "order_by": order_by, "order": order,
        "filters": {"site": site, "asins": asins or None, "skus": skus or None},
        "rows": page, "total": len(rows), "limit": limit, "offset": offset,
        "totals_by_site": totals,
        "coverage": {
            "group_count": len(rows), "incomplete_group_count": incomplete_groups,
            "rule": "business rows only (snapshot rows excluded); a group is complete when every constituent ASIN has one complete business row for every day of the period",
        },
        "definitions": {
            "units": "daily_sales summed", "cvr": "units / sessions", "order_cvr": "orders / sessions", "aov": "revenue / units",
            "acos": "ad_spend / ad_sales", "tacos": "ad_spend / revenue", "cpc": "ad_spend / ad_clicks", "ad_cvr": "ad_orders / ad_clicks",
            "ad_sales_share": "ad_sales / revenue", "latest measures": "latest non-zero value in the current period",
            "ratios": "decimal fractions, e.g. 0.0909 = 9.09%",
        },
        "currency_note": "money measures are in each site's local currency; groups spanning several currencies report money as null",
        "population_provenance": {
            "authorization_filter": "current_dingtalk_user", "result_population": "observed_business_rows",
            "absent_authorized_entities": "unknown_not_zero",
        },
    }


def _baseline(value, start: date, end: date, parse) -> tuple[date, date] | None:
    if value in (None, "", False):
        return None
    length = (end - start).days + 1
    if value in ("previous_period", True):
        base_end = start - timedelta(days=1)
        return base_end - timedelta(days=length - 1), base_end
    if value == "previous_year":
        return start.replace(year=start.year - 1), end.replace(year=end.year - 1)
    if isinstance(value, dict):
        base_start = parse(value.get("start_date"), None)
        base_end = parse(value.get("end_date"), None)
        if not base_start or not base_end or base_start > base_end or (base_end - base_start).days + 1 > MAX_DAYS:
            raise ValueError("compare 需要合法的 start_date/end_date")
        return base_start, base_end
    raise ValueError("compare 只能是 previous_period、previous_year 或 {start_date, end_date}")


def _string_list(value, name: str, upper: bool, limit: int) -> list[str]:
    if value in (None, "", []):
        return []
    items = value if isinstance(value, list) else str(value).split(",")
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    if len(cleaned) > limit or any(len(item) > 40 for item in cleaned):
        raise ValueError(f"{name} 最多 {limit} 个且单个不超过 40 字符")
    return [item.upper() for item in cleaned] if upper else cleaned


def _is_money(measure: str) -> bool:
    return (measure in ADDITIVE and ADDITIVE[measure][1]) or (measure in DERIVED and DERIVED[measure][2]) or measure in MONEY_LATEST


def _ratio(numerator, denominator):
    if numerator is None or denominator in (None, 0):
        return None
    return round(float(numerator) / float(denominator), 6)


def _number(value):
    if value is None:
        return None
    number = float(value)
    return int(number) if number.is_integer() else round(number, 4)


def _store_catalog(db, sids: list[int]) -> dict:
    rows = db.daily_product_analysis.fetch_all(
        "SELECT lingxing_sid, name, country FROM cbops_sys_store_catalog WHERE lingxing_sid = ANY(%s)", (sorted(set(sids)),))
    return {int(dict(row)["lingxing_sid"]): dict(row) for row in rows}


def _shape_row(raw: dict, dimensions: list[str], measures: list[str], baseline, days: int, site_filter, stores: dict) -> dict:
    row: dict = {}
    for name in dimensions:
        value = raw.get(f"dim_{name}")
        if name == "store":
            store = stores.get(int(value)) if value is not None else None
            row["lingxing_sid"] = int(value) if value is not None else None
            row["store_name"] = store.get("name") if store else None
        elif name == "date":
            row["date"] = value.isoformat() if hasattr(value, "isoformat") else value
        else:
            row[name] = value
    single_site = int(raw.get("site_count") or 0) <= 1
    site = raw.get("dim_site") or site_filter or (raw.get("any_site") if single_site else None)
    currency = CURRENCY_BY_MARKET.get(canonical_amazon_marketplace(str(site or "")) or "") if single_site else None
    if single_site and "site" not in row:
        row["site"] = site
    row["currency"] = currency
    current = {name: raw.get(f"cur_{name}") for name in ADDITIVE}
    base = {name: raw.get(f"base_{name}") for name in ADDITIVE} if baseline else {}
    # Raw sums travel with the row so totals can recompute ratios; stripped before output.
    row["_sums"] = {name: _number(value) for name, value in current.items() if value is not None and (currency or not ADDITIVE[name][1])}
    row["_base_sums"] = {name: _number(value) for name, value in base.items() if value is not None and (currency or not ADDITIVE[name][1])}

    def value_of(values: dict, name: str):
        if name in ADDITIVE:
            result = _number(values.get(name))
        elif name in DERIVED:
            numerator, denominator, _ = DERIVED[name]
            result = _ratio(values.get(numerator), values.get(denominator))
        else:
            result = _number(raw.get(f"latest_{name}")) if values is current else None
        return None if _is_money(name) and currency is None else result

    metrics = {name: value_of(current, name) for name in measures}
    row["metrics"] = metrics
    if baseline:
        base_metrics = {name: value_of(base, name) for name in measures if name not in LATEST}
        row["baseline"] = base_metrics
        change = {}
        for name, before in base_metrics.items():
            after = metrics.get(name)
            if after is None or before is None:
                change[name] = None
                continue
            delta = round(float(after) - float(before), 6)
            change[name] = {"abs": _number(delta), "pct": _ratio(delta, before) if name in ADDITIVE else None}
        row["change"] = change
    constituents = int(raw.get("constituents") or 0)
    business_rows = int(raw.get("business_rows") or 0)
    expected = constituents * (1 if "date" in dimensions else days)
    coverage = {
        "constituent_asins": constituents, "business_rows": business_rows, "expected_rows": expected,
        "business_days": int(raw.get("business_days") or 0), "incomplete_rows": int(raw.get("incomplete_rows") or 0),
        "complete": business_rows == expected and not int(raw.get("incomplete_rows") or 0),
    }
    if baseline:
        base_constituents = int(raw.get("base_constituents") or 0)
        base_days = (baseline[1] - baseline[0]).days + 1
        coverage.update({"baseline_business_rows": int(raw.get("base_business_rows") or 0),
                         "baseline_expected_rows": base_constituents * base_days,
                         "baseline_incomplete_rows": int(raw.get("base_incomplete_rows") or 0)})
        coverage["baseline_complete"] = coverage["baseline_business_rows"] == coverage["baseline_expected_rows"] and not coverage["baseline_incomplete_rows"]
    row["coverage"] = coverage
    return row


def _sort_key(row: dict, order_by: str, dimensions: list[str]):
    if order_by == "date" and "date" in dimensions:
        return (1, row.get("date") or "")
    if order_by.endswith("_change"):
        change = (row.get("change") or {}).get(order_by[:-7])
        value = change.get("abs") if isinstance(change, dict) else None
    else:
        value = row["metrics"].get(order_by)
    return (0, 0) if value is None else (1, value)


def _totals(rows: list[dict], measures: list[str], baseline) -> list[dict]:
    """Per-site totals over every matching group (not just the returned page)."""
    by_site: dict = {}
    for row in rows:
        key = row.get("site") or row.get("currency") or "mixed"
        bucket = by_site.setdefault(key, {"site": row.get("site"), "currency": row.get("currency"), "cur": {}, "base": {}, "groups": 0, "incomplete_groups": 0})
        bucket["groups"] += 1
        bucket["incomplete_groups"] += 0 if row["coverage"]["complete"] else 1
        for scope, values in (("cur", row["_sums"]), ("base", row["_base_sums"])):
            for name, value in values.items():
                bucket[scope][name] = bucket[scope].get(name, 0) + value
    output = []
    for bucket in by_site.values():
        def pick(values: dict) -> dict:
            result = {}
            for name in measures:
                if name in ADDITIVE:
                    result[name] = _number(values.get(name)) if name in values else None
                elif name in DERIVED:
                    numerator, denominator, _ = DERIVED[name]
                    result[name] = _ratio(values.get(numerator), values.get(denominator)) if numerator in values and denominator in values else None
            return result
        entry = {"site": bucket["site"], "currency": bucket["currency"], "groups": bucket["groups"],
                 "incomplete_groups": bucket["incomplete_groups"], "metrics": pick(bucket["cur"])}
        if baseline:
            entry["baseline"] = pick(bucket["base"])
        output.append(entry)
    return output
