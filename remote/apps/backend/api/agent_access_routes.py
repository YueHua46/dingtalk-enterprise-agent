"""Admin API for generic DingTalk-to-store Agent data grants."""

from __future__ import annotations

import hmac
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, request

from api.common import json_error, json_safe_value, json_success
from api.user_routes import require_manager
from config.settings import CROSSBORDEROPS_INTERNAL_TOKEN
from extensions import csrf
from services.agent_data_access_service import AgentDataAccessService
from services.dingtalk_directory_service import DingTalkDirectoryService

agent_access_bp = Blueprint("agent_access", __name__, url_prefix="/agent-access")
_access = AgentDataAccessService()
_directory = DingTalkDirectoryService(_access.directory)


@agent_access_bp.route("/dingtalk-candidates", methods=["GET"])
@require_manager
def candidates(_actor):
    if not _access.is_available:
        return json_error("未配置 DATABASE_URL", status=503)
    corp_id = str(request.args.get("corp_id") or "").strip() or None
    return json_success(data={"candidates": json_safe_value(_directory.candidates(corp_id))})


@agent_access_bp.route("/dingtalk-sync", methods=["POST"])
@require_manager
def sync_directory(_actor):
    body = request.get_json(silent=True) or {}
    try:
        result = _directory.sync(body.get("corp_id"))
        return json_success(message="钉钉通讯录同步完成", data=json_safe_value(result))
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception as exc:
        return json_error(str(exc), status=503)


@agent_access_bp.route("/options", methods=["GET"])
@require_manager
def options(_actor):
    try:
        return json_success(data=json_safe_value(_access.options()))
    except Exception as exc:
        return json_error(str(exc), status=503)


@agent_access_bp.route("/grants", methods=["GET"])
@require_manager
def list_grants(_actor):
    corp_id = str(request.args.get("corp_id") or "").strip() or None
    return json_success(data={"grants": json_safe_value(_access.grants_payload(corp_id))})


@agent_access_bp.route("/preview-scope", methods=["GET"])
@require_manager
def preview_scope(_actor):
    corp_id = str(request.args.get("corp_id") or "").strip()
    user_id = str(request.args.get("user_id") or "").strip()
    if not corp_id or not user_id:
        return json_error("corp_id 和 user_id 均必填", status=400)
    return json_success(data=json_safe_value(_access.effective_scope(corp_id, user_id)))


@agent_access_bp.route("/preview-grant", methods=["POST"])
@require_manager
def preview_grant(_actor):
    try:
        return json_success(data=json_safe_value(_access.preview_new_grant(request.get_json(silent=True) or {})))
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)


@agent_access_bp.route("/grants", methods=["POST"])
@require_manager
def create_grant(actor):
    try:
        row = _access.create(request.get_json(silent=True) or {}, int(actor.get("id") or 0) or None)
        return json_success(message="Agent 数据授权已创建", data={"grant": json_safe_value(row)})
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)


@agent_access_bp.route("/grants/<int:grant_id>", methods=["PUT"])
@require_manager
def update_grant(actor, grant_id: int):
    try:
        row = _access.update(grant_id, request.get_json(silent=True) or {}, int(actor.get("id") or 0) or None)
        return json_success(message="Agent 数据授权已更新", data={"grant": json_safe_value(row)})
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)


@agent_access_bp.route("/grants/<int:grant_id>", methods=["DELETE"])
@require_manager
def delete_grant(_actor, grant_id: int):
    if not _access.grants.delete_grant(grant_id, int(_actor.get("id") or 0) or None):
        return json_error("授权映射不存在", status=404)
    return json_success(message="Agent 数据授权已删除")


@agent_access_bp.route("/audits", methods=["GET"])
@require_manager
def list_audits(_actor):
    corp_id = str(request.args.get("corp_id") or "").strip() or None
    limit = request.args.get("limit", 100, type=int)
    return json_success(data={"audits": json_safe_value(_access.audits(corp_id, limit))})


@agent_access_bp.route("/effective-scope/<path:corp_id>/<path:user_id>", methods=["GET"])
def effective_scope(corp_id: str, user_id: str):
    expected = CROSSBORDEROPS_INTERNAL_TOKEN
    received = request.headers.get("X-CrossBorderOps-Internal-Token", "")
    if not expected or not hmac.compare_digest(received, expected):
        return json_error("未授权", status=401)
    try:
        scope = _access.effective_scope(corp_id, user_id)
        from datetime import datetime, timezone
        scope["scope_calculated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return json_success(data=json_safe_value(scope))
    except Exception as exc:
        return json_error(str(exc), status=503)


def _parse_query_date(value, fallback: date) -> date:
    raw = str(value or "").strip()
    if not raw:
        return fallback
    return datetime.strptime(raw[:10], "%Y-%m-%d").date()


def _query_sids(scope: dict, params: dict) -> list[int]:
    allowed = {int(value) for value in scope.get("lingxing_sids") or []}
    requested = params.get("store_sids", params.get("store_sid"))
    if requested in (None, ""):
        return sorted(allowed)
    if not isinstance(requested, list):
        requested = [requested]
    try:
        selected = sorted({int(value) for value in requested})
    except (TypeError, ValueError) as exc:
        raise ValueError("store_sids 必须为整数列表") from exc
    if not set(selected).issubset(allowed):
        raise PermissionError("请求范围包含当前钉钉用户未授权店铺")
    return selected


def _daily_scope(sids: list[int]) -> dict:
    return {"allowed_sites": None, "allowed_registration_identities": None, "allowed_lingxing_sids": set(sids)}


def _daily_query(dataset: str, params: dict, sids: list[int]):
    from api.daily_analysis_routes import _site_revenue_rows
    from api.daily_analysis_serialize import serialize_product_detail_row
    from database.database import Database
    from services.daily_analysis_ai_service import DailyAnalysisAIService
    from services.daily_data_availability import daily_data_availability, default_daily_end_date

    db = Database()
    scope = _daily_scope(sids)
    end = _parse_query_date(params.get("end_date"), default_daily_end_date(db, **scope))
    start = _parse_query_date(params.get("start_date"), end - timedelta(days=max(1, int(params.get("days") or 7)) - 1))
    if start > end:
        raise ValueError("start_date 不能晚于 end_date")
    if dataset == "daily.availability":
        return daily_data_availability(db, **scope)
    if dataset == "daily.performance_changes":
        from services.agent_performance_change_service import performance_changes
        return performance_changes(sids, params)
    if dataset == "daily.aggregate":
        from services.agent_daily_aggregate_service import aggregate_daily
        return aggregate_daily(sids, params)
    if dataset == "daily.metrics":
        from services.agent_daily_metrics_service import daily_metrics
        return daily_metrics(sids, params)
    if dataset == "daily.summary":
        summary = db.daily_product_analysis.get_summary(end, **scope) if start == end else db.daily_product_analysis.get_summary_range(start, end, **scope)
        revenue = db.daily_product_analysis.get_revenue_by_site(end, **scope) if start == end else db.daily_product_analysis.get_revenue_by_site_range(start, end, **scope)
        return {"start_date": start.isoformat(), "end_date": end.isoformat(), "summary": list(summary[0:6]) if summary else [0, 0, 0, 0, 0, 0], "revenue_by_site": _site_revenue_rows(revenue)}
    if dataset == "daily.trend":
        rows = db.daily_product_analysis.get_trend(start, end, **scope)
        # The underlying report sums store-local currency values. Across stores
        # that number has no monetary unit, so never expose it as an amount.
        single_store = len(set(sids)) == 1
        return [{"date": row[0].isoformat() if row[0] else None, "total_sales": row[1] or 0, "total_revenue": float(row[2] or 0) if single_store else None, "total_orders": row[3] or 0, "avg_conversion_rate": float(row[4] or 0) * 100, "total_sessions": int(row[6] or 0) if len(row) > 6 else 0, "avg_buy_box_pct": float(row[7] or 0) * 100 if len(row) > 7 else 0, "total_ad_spend": float(row[8] or 0) if single_store and len(row) > 8 else None, "avg_acos": float(row[9] or 0) * 100 if len(row) > 9 else 0, "money_scope": "single_store_local_currency" if single_store else "mixed_store_currencies_not_aggregatable"} for row in rows]
    if dataset == "daily.top_products":
        limit = max(1, min(int(params.get("limit") or 20), 200))
        rows = db.daily_product_analysis.get_top_products(start, end, limit, **scope)
        return [{"product_id": str(row[0]), "asin": row[1], "product_name": row[2], "category": row[3], "operator": row[4] or "", "total_sales": row[6] or 0, "total_revenue": float(row[7] or 0), "lingxing_sid": int(row[11]) if len(row) > 11 and row[11] is not None else None, "store_name": row[12] if len(row) > 12 else None} for row in rows]
    if dataset == "daily.products":
        from database.models.daily_product_analysis_sql import SELECT_BY_DATE_RANGE_SQL
        if (end - start).days > 13:
            raise ValueError("daily.products 最多查询 14 天；跨店铺发现请使用 daily.performance_changes")
        limit = max(1, min(int(params.get("limit") or 100), 200))
        offset = max(0, min(int(params.get("offset") or 0), 10000))
        clause, extra = db.daily_product_analysis._access_filter_clause(None, None, set(sids), lingxing_sid_column="analysis.lingxing_sid")
        # Snapshot rows duplicate the business row with zero-filled sales.
        clause += "" if params.get("include_snapshots") else " AND analysis.source_type <> 'snapshot'"
        sql = SELECT_BY_DATE_RANGE_SQL.replace("ORDER BY", f"{clause}\nORDER BY") + " LIMIT %s OFFSET %s"
        rows = db.daily_product_analysis.fetch_all(sql, (start, end, *extra, limit, offset))
        return [serialize_product_detail_row(row, None) for row in rows]
    if dataset == "daily.product":
        asin = str(params.get("asin") or "").strip().upper()
        if not asin:
            raise ValueError("daily.product 需要 asin")
        from database.models.daily_product_analysis_sql import SELECT_BY_ASIN_SQL
        if (end - start).days > 29:
            raise ValueError("daily.product 最多查询 30 天")
        clause, extra = db.daily_product_analysis._access_filter_clause(None, None, set(sids), lingxing_sid_column="analysis.lingxing_sid")
        clause += "" if params.get("include_snapshots") else " AND analysis.source_type <> 'snapshot'"
        sql = SELECT_BY_ASIN_SQL.replace("ORDER BY", f" AND analysis.analysis_date BETWEEN %s AND %s {clause}\nORDER BY") + " LIMIT 500"
        rows = db.daily_product_analysis.fetch_all(sql, (asin, start, end, *extra))
        return [serialize_product_detail_row(row, None) for row in rows]
    if dataset == "daily.analyze":
        service = DailyAnalysisAIService()
        kind = str(params.get("kind") or "trend").strip().lower()
        if kind == "category":
            return service.analyze_category(int(params.get("days") or 30), focus_date=params.get("focus_date"), **scope, display_currency=str(params.get("display_currency") or "CNY"))
        if kind == "product":
            return service.analyze_product(asin=str(params.get("asin") or "").strip().upper() or None, product_id=params.get("product_id"), focus_date=params.get("focus_date"), **scope)
        return service.analyze_trend(int(params.get("days") or 30), focus_date=params.get("focus_date"), **scope, display_currency=str(params.get("display_currency") or "CNY"))
    raise ValueError("不支持的日报数据集")


def _ads_query(dataset: str, params: dict, sids: list[int]):
    from database.database import Database
    from services.ad_optimization_service import _parse_date
    db = Database()
    start = _parse_date(params.get("start_date"))
    end = _parse_date(params.get("end_date"))
    limit = max(1, min(int(params.get("limit") or 100), 500))
    offset = max(0, int(params.get("offset") or 0))
    q = params.get("q") or None
    if dataset == "ads.summary":
        return {
            "sp": [row for sid in sids for row in db.ad_reports.daily_summary_sp(sid=sid, start_date=start, end_date=end)],
            "sb": [row for sid in sids for row in db.ad_reports.daily_summary_sb(sid=sid, start_date=start, end_date=end)],
            "placements": [row for sid in sids for row in db.ad_reports.daily_summary_sp_placements(sid=sid, start_date=start, end_date=end)],
        }
    rows = []
    total = 0
    # Fetch each store's prefix, then apply the page offset once to the
    # merged result. Applying the same offset per store skips valid rows.
    per_store_limit = offset + limit
    for sid in sids:
        if dataset == "ads.sp_search_terms":
            page, count = db.ad_reports.list_sp_search_terms(sid=sid, start_date=start, end_date=end, q=q, limit=per_store_limit, offset=0)
        elif dataset == "ads.sb_search_terms":
            page, count = db.ad_reports.list_sb_search_terms(sid=sid, start_date=start, end_date=end, q=q, limit=per_store_limit, offset=0)
        elif dataset == "ads.placements":
            page, count = db.ad_reports.list_sp_placements(sid=sid, start_date=start, end_date=end, limit=per_store_limit, offset=0)
        else:
            raise ValueError("不支持的广告数据集")
        rows.extend(page)
        total += int(count or 0)
    rows.sort(key=lambda row: (str(row.get("report_date") or ""), float(row.get("spend") or 0), int(row.get("id") or 0)), reverse=True)
    return {"rows": rows[offset:offset + limit], "total": total, "limit": limit, "offset": offset}


def _reviews_query(dataset: str, params: dict, sids: list[int]):
    from database.models.active_listing_catalog import ActiveListingCatalog
    from database.database import Database
    from services.review_service import ReviewService
    db = Database()
    service = ReviewService()
    result = service.fetch_negative_reviews_from_db(
        db.comp_critical_reviews,
        start_date=params.get("start_date"), end_date=params.get("end_date"), asin=params.get("asin"), marketplace=params.get("marketplace"),
        operator=params.get("operator"), source=params.get("source"), allowed_store_sids=set(sids), stars=params.get("stars", "1,2,3"),
    )
    visible_keys = ActiveListingCatalog().active_product_keys(set(sids))
    visible_rows = [row for row in result.get("data") or [] if (str(row.get("marketplace") or "US").upper(), str(row.get("asin") or "").upper()) in visible_keys]
    result["data"] = visible_rows
    result["total"] = len(visible_rows)
    result["statistics"] = service.calculate_negative_review_stats(visible_rows)
    if dataset == "reviews.negative":
        return result
    if dataset == "reviews.statistics":
        return {"statistics": result.get("statistics"), "date_range": result.get("date_range"), "total": result.get("total")}
    raise ValueError("不支持的评论数据集")


def _rank_query(dataset: str, params: dict, sids: list[int]):
    from database.database import Database
    db = Database()
    allowed = set(sids)
    plans = db.amazon_rank_tracker.list_plans(include_archived=True)
    plan_ids = [int(plan["id"]) for plan in plans if plan.get("store_sid") is not None and int(plan.get("store_sid")) in allowed]
    requested_sid = int(params["store_sid"]) if str(params.get("store_sid") or "").isdigit() else None
    if requested_sid is not None and requested_sid not in allowed:
        raise PermissionError("请求范围包含当前钉钉用户未授权店铺")
    filters = {"plan_ids": plan_ids, "start_date": params.get("start_date"), "end_date": params.get("end_date"), "asin": params.get("asin"), "marketplace": params.get("marketplace"), "keyword": params.get("keyword"), "rank_type": params.get("rank_type"), "status": params.get("status"), "store_sid": requested_sid, "limit": max(1, min(int(params.get("limit") or 5000), 20000)), "offset": max(0, int(params.get("offset") or 0))}
    if dataset in {"rank.results", "rank.trends"}:
        return db.amazon_rank_tracker.query_results(**filters)
    if dataset == "rank.summary":
        return {"plan_count": len(plan_ids), **db.amazon_rank_tracker.summarize_results(**filters)}
    if dataset == "rank.analysis":
        from services.amazon_rank_analysis_service import AmazonRankAnalysisService
        return AmazonRankAnalysisService().data_snapshot(include_data_health=False, **{key: value for key, value in filters.items() if key not in {"limit", "offset"}})
    raise ValueError("不支持的排名数据集")


@agent_access_bp.route("/query", methods=["POST"])
@csrf.exempt
def query_agent_data():
    expected = CROSSBORDEROPS_INTERNAL_TOKEN
    received = request.headers.get("X-CrossBorderOps-Internal-Token", "")
    if not expected or not hmac.compare_digest(received, expected):
        return json_error("未授权", status=401)
    body = request.get_json(silent=True) or {}
    corp_id = str(body.get("corp_id") or "").strip()
    user_id = str(body.get("dingtalk_user_id") or "").strip()
    dataset = str(body.get("dataset") or "").strip()
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    if not corp_id or not user_id or not dataset:
        return json_error("corp_id、dingtalk_user_id、dataset 均必填", status=400)
    try:
        scope = _access.effective_scope(corp_id, user_id)
        if not scope.get("has_access") or not scope.get("lingxing_sids"):
            return json_error("当前钉钉用户没有有效 Amazon 店铺授权", status=403)
        sids = _query_sids(scope, params)
        if not sids:
            return json_error("当前查询范围为空", status=403)
        if dataset.startswith("daily."):
            data = _daily_query(dataset, params, sids)
        elif dataset.startswith("ads."):
            data = _ads_query(dataset, params, sids)
        elif dataset.startswith("reviews."):
            data = _reviews_query(dataset, params, sids)
        elif dataset.startswith("rank."):
            data = _rank_query(dataset, params, sids)
        else:
            return json_error("不支持的数据集", status=400)
        return json_success(data={"dataset": dataset, "data": json_safe_value(data), "scope": json_safe_value(scope), "evidence": {"queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "crossborderops", "authorized_lingxing_sids": sids, "requested_start_date": params.get("start_date"), "requested_end_date": params.get("end_date")}})
    except PermissionError as exc:
        return json_error(str(exc), status=403)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception as exc:
        return json_error(f"CrossBorderOps 数据查询失败：{exc}", status=503)
