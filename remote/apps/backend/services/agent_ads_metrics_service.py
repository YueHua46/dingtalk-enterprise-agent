"""Read-only, scope-bound aggregation of stored advertising reports.

Report families remain separate: placement, product-ad and search-term rows
are overlapping views, not additive advertising channels. All SQL identifiers
are from fixed schema maps; user filters are always bound parameters.
"""
from collections import defaultdict
from decimal import Decimal


REPORTS = {
    "sp_search_terms": "cbops_ads_sp_search_term_report_detail",
    "sb_search_terms": "cbops_ads_sb_search_term_report_detail",
    "placements": "cbops_ads_sp_placement_report_detail",
    "sp_products": "cbops_ads_sp_product_ad_report_detail",
}
DIMENSIONS = {
    "store": ["sid"], "date": ["report_date"],
    "campaign": ["campaign_id"], "ad_group": ["campaign_id", "ad_group_id"],
    "target": ["campaign_id", "ad_group_id", "keyword_text", "match_type", "targeting_type"],
    "search_term": ["campaign_id", "ad_group_id", "keyword_text", "match_type", "customer_search_term"],
    "placement": ["placement"], "asin": ["asin"], "sku": ["asin", "sku"],
}
MEASURES = ("impressions", "clicks", "spend", "sales", "orders")


def metrics(row):
    result = dict(row)
    def ratio(n, d, scale=1):
        denominator = Decimal(str(row.get(d) or 0))
        return round(float(Decimal(str(row.get(n) or 0)) / denominator * scale), 6) if denominator else None
    result.update(ctr=ratio("clicks", "impressions", 100), cvr=ratio("orders", "clicks", 100),
                  cpc=ratio("spend", "clicks"), cpa=ratio("spend", "orders"),
                  acos=ratio("spend", "sales", 100), roas=ratio("sales", "spend"))
    return result


def ads_metrics(db, sids, params, start, end):
    dimensions = params.get("dimensions", ["store", "campaign"])
    sources = params.get("sources", ["sp_search_terms", "sb_search_terms"])
    if not isinstance(dimensions, list) or not dimensions or any(d not in DIMENSIONS for d in dimensions):
        raise ValueError("dimensions 必须为 store/date/campaign/ad_group/target/search_term/placement/asin/sku 的非空列表")
    if not isinstance(sources, list) or not sources or any(s not in REPORTS for s in sources):
        raise ValueError("sources 必须为 sp_search_terms/sb_search_terms/placements/sp_products 的非空列表")
    columns = list(dict.fromkeys(["sid"] + [c for d in dimensions for c in DIMENSIONS[d]]))
    order = params.get("order_by", "spend")
    if order not in (*MEASURES, "ctr", "cvr", "cpc", "cpa", "acos", "roas"):
        raise ValueError("order_by 必须是返回的数值指标")
    rows = []
    for source in dict.fromkeys(sources):
        available = {"sid", "report_date", "campaign_id"}
        if source in ("sp_search_terms", "sb_search_terms"):
            available.update(["ad_group_id", "keyword_text", "match_type", "targeting_type", "customer_search_term"])
        elif source == "placements":
            available.add("placement")
        else:
            available.update(["ad_group_id", "asin", "sku"])
        if not set(columns).issubset(available):
            raise ValueError(f"{source} 不支持所选维度；不同报告不能据名称猜测对象关联")
        filters = ["sid = ANY(%s)", "report_date BETWEEN %s AND %s"]
        values = [sids, start, end]
        for key, column in [("campaign_ids", "campaign_id"), ("ad_group_ids", "ad_group_id"), ("asins", "asin")]:
            if key not in params:
                continue
            if column not in available or not isinstance(params[key], list) or not params[key] or len(params[key]) > 200:
                raise ValueError(f"{source} 的 {key} 筛选无效或不受支持")
            filters.append(f"{column} = ANY(%s)")
            values.append([str(v) for v in params[key]])
        if params.get("q"):
            if "customer_search_term" not in available:
                raise ValueError(f"{source} 不支持 q")
            filters.append("(customer_search_term ILIKE %s OR keyword_text ILIKE %s)")
            values.extend([f"%{params['q']}%"] * 2)
        group = ", ".join(columns)
        aggregates = ", ".join(f"SUM({m}) AS {m}" for m in MEASURES)
        # Labels are attributes of the scoped ID, never grouping keys: a rename
        # must not split metrics or merge two IDs sharing the same name.
        label_fields = [] if source == "sp_products" else [
            name for identity, name in [("campaign_id", "campaign_name"), ("ad_group_id", "ad_group_name")]
            if identity in columns and identity in available]
        labels = "".join(
            f", (ARRAY_AGG({name} ORDER BY report_date DESC, id DESC) "
            f"FILTER (WHERE NULLIF(BTRIM({name}), '') IS NOT NULL))[1] AS {name}"
            f", ARRAY_AGG(DISTINCT {name}) FILTER (WHERE NULLIF(BTRIM({name}), '') IS NOT NULL) AS {name}_variants"
            for name in label_fields)
        result = db.ad_reports._fetch_dicts(
            f"SELECT {group}, {aggregates}, COUNT(*) AS source_rows, "
            f"MIN(report_date) AS first_date, MAX(report_date) AS last_date, "
            f"COUNT(DISTINCT report_date) AS observed_days{labels} FROM {REPORTS[source]} "
            f"WHERE {' AND '.join(filters)} GROUP BY {group}", values)
        rows.extend(metrics({**row, "report": source}) for row in result)
    # A rank is computed over all matching groups, never over a detail page.
    rows.sort(key=lambda r: (r.get(order) is not None, r.get(order) or 0, str([r.get(c) for c in columns]), r["report"]), reverse=True)
    totals = defaultdict(lambda: {m: Decimal(0) for m in MEASURES})
    for row in rows:
        for measure in MEASURES:
            totals[(row["sid"], row["report"])][measure] += Decimal(str(row.get(measure) or 0))
    limit = max(1, min(int(params.get("limit") or 100), 500))
    offset = max(0, int(params.get("offset") or 0))
    page = rows[offset:offset+limit]
    # Some source reports contain IDs but no names. Resolve labels from the
    # existing campaign snapshots, scoped to the same stores, ad family and
    # observation window. Do not join fact rows (which would multiply totals).
    missing_names = [r for r in page if r.get("campaign_id") and not r.get("campaign_name")]
    if missing_names:
        snapshots = db.ad_reports._fetch_dicts(
            "SELECT DISTINCT ON (sid, ad_type, campaign_id) sid, ad_type, campaign_id, campaign_name, biz_date "
            "FROM cbops_ads_campaign_daily_snapshot WHERE sid = ANY(%s) AND campaign_id = ANY(%s) "
            "AND biz_date BETWEEN %s AND %s AND NULLIF(BTRIM(campaign_name), '') IS NOT NULL "
            "ORDER BY sid, ad_type, campaign_id, biz_date DESC, snapshot_version DESC, captured_at DESC, id DESC",
            [sids, list({r['campaign_id'] for r in missing_names}), start, end])
        labels = {(r['sid'], r.get('ad_type'), r.get('campaign_id')): r for r in snapshots}
        for row in missing_names:
            ad_type = 'SB' if row['report'] == 'sb_search_terms' else 'SP'
            label = labels.get((row['sid'], ad_type, row['campaign_id']))
            if label and label.get('campaign_name'):
                row['campaign_name'] = label['campaign_name']
                row['campaign_name_source'] = {'dataset': 'campaign_daily_snapshot', 'date': str(label['biz_date']), 'ad_type': ad_type}
    has_more = offset + len(page) < len(rows)
    field_coverage = {
        column: {"groups_with_value": sum(1 for row in rows if row.get(column) is not None and str(row[column]).strip()),
                 "groups_missing_value": sum(1 for row in rows if row.get(column) is None or not str(row[column]).strip())}
        for column in columns
    }
    return {
        "rows": page, "total": len(rows), "offset": offset, "limit": limit,
        "dimensions": list(dict.fromkeys(["store"] + dimensions)),
        "dimension_field_coverage": {"basis": "all_matching_groups", "fields": field_coverage},
        "period": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "filters": {k: v for k, v in params.items() if k not in ("offset", "limit")},
        "totals_by_store_report": [metrics({"sid": sid, "report": report, **values}) for (sid, report), values in sorted(totals.items())],
        "metric_units": {"ctr": "percent", "cvr": "percent", "acos": "percent", "amounts": "store_local_currency"},
        "coverage": {"mode": "page" if has_more or offset else "complete", "basis": "all_matching_stored_rows_aggregated_before_pagination",
                     "total": len(rows), "offset": offset, "returned": len(page), "limit": limit,
                     "has_more": has_more, "next_offset": offset+len(page) if has_more else None,
                     "upstream_acquisition_completeness": "not_verified", "population": "stored_report_rows"},
        "semantics": {"report_families_overlap": True, "combine_only_disjoint_channels": ["sp_search_terms", "sb_search_terms"],
                      "dimension_fields": {"keyword_text": "configured_keyword_or_target_expression",
                                           "customer_search_term": "actual_customer_query_when_present",
                                           "asin": "advertised_product_asin_not_targeted_asin"},
                      "missing_dimension": "unknown_entity_value_not_an_identified_object",
                      "object_names": "original stored names; latest nonempty within selected report period; variants preserve renames; missing campaign names resolved from same-store, same-ad-type period snapshots with source/date; identity remains store+report+IDs; missing names remain unknown",
                      "missing_store_or_date": "unknown_not_zero", "actual_bid_budget_cost_profit": "not_provided"},
    }
