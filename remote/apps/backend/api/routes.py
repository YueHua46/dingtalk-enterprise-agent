from html import escape as html_escape
from pathlib import Path

import pandas as pd
from flask import Blueprint, jsonify, request, send_file
from flask_wtf.csrf import generate_csrf

from api.auth_session import session_user
from api.common import get_db, json_error, json_safe_list, json_success
from api.ad_framework_routes import ad_framework_bp
from api.ad_optimization_routes import ad_optimization_bp
from api.competitor_routes import analyze_competitor_range, competitor_bp, query_us_natural_rank
from api.competitor_research_routes import competitor_research_bp
from api.daily_analysis_routes import daily_analysis_bp
from api.keyword_root_routes import keyword_root_bp
from api.keyword_tag_routes import keyword_tag_bp
from api.tag_definition_routes import tag_definition_bp
from api.sif_keyword_routes import sif_keyword_bp
from api.review_routes import review_bp
from api.task_routes import task_bp
from api.llm_config_routes import llm_config_bp
from api.mcp_config_routes import mcp_config_bp
from api.dingtalk_config_routes import dingtalk_config_bp
from api.external_integration_routes import external_integration_bp
from api.auth_routes import auth_bp
from api.user_routes import user_bp
from api.knowledge_routes import knowledge_bp
from api.ai_chat_routes import ai_chat_bp
from api.agent_routes import agent_bp
from api.remote_execution_routes import remote_execution_bp
from api.workflow_routes import workflow_bp
from api.commerce_intel_routes import commerce_intel_bp
from api.ops_insight_routes import ops_insight_bp
from api.store_access_routes import store_access_bp
from api.amazon_rank_tracker_routes import amazon_rank_bp
from api.amazon_shipment_routes import amazon_shipment_bp
from api.proxy_pool_routes import proxy_pool_bp
from api.agent_access_routes import agent_access_bp
from config.settings import APP_VERSION, OUTPUT_DIR
from services.boc_exchange_rate_service import BocExchangeRateService
from services.exchange_rate_fallback_service import ExchangeRateFallbackService
from services.pricing_service import PricingService
from services.pricing_sop_history_service import list_sop_history, resolve_sop_file
from services.pricing_sop_simulate_service import PricingSimulateError, simulate_pricing


api_bp = Blueprint("api", __name__)
# 亚马逊广告 / 关键词域（PostgreSQL 四表，见 database/table_names.py）：
#   GET/POST/PATCH/DELETE /ad-framework/*  — 词库行运营（cbops_kw_sif_asin_keyword_base）
#   POST /sif-keywords/sync — SIF 拉取入库（竞品测试面板固定调用）
#   GET  /sif-keywords      — 与 ad-framework 列表同义（兼容）
#   /keyword-tags/*         — 标签下拉简表（同 cbops_kw_tag_definition_base）
#   /tag-definitions/*      — 标签字典完整 CRUD
#   /keyword-roots/*        — 全库词根目录 catalog、打标、AI 属性批量（word_root.tag_id + ops_tag_id + map）
api_bp.register_blueprint(competitor_bp)
api_bp.register_blueprint(competitor_research_bp)
# 静态子路径须在 /<int:product_id> 之前注册；挂到 api_bp 避免 blueprint 合并顺序导致 404
api_bp.add_url_rule(
    "/competitors/us-natural-rank",
    view_func=query_us_natural_rank,
    methods=["POST"],
    endpoint="query_us_natural_rank",
)
api_bp.add_url_rule(
    "/competitors/<int:product_id>/analyze-range",
    view_func=analyze_competitor_range,
    methods=["POST"],
    endpoint="analyze_competitor_range",
)
api_bp.register_blueprint(ad_optimization_bp)
api_bp.register_blueprint(sif_keyword_bp)
api_bp.register_blueprint(keyword_tag_bp)
api_bp.register_blueprint(tag_definition_bp)
api_bp.register_blueprint(keyword_root_bp)
api_bp.register_blueprint(ad_framework_bp)
api_bp.register_blueprint(daily_analysis_bp)
api_bp.register_blueprint(review_bp)
api_bp.register_blueprint(task_bp)
api_bp.register_blueprint(llm_config_bp)
api_bp.register_blueprint(mcp_config_bp)
api_bp.register_blueprint(dingtalk_config_bp)
api_bp.register_blueprint(external_integration_bp)
api_bp.register_blueprint(auth_bp)
api_bp.register_blueprint(user_bp)
api_bp.register_blueprint(knowledge_bp)
api_bp.register_blueprint(ai_chat_bp)
api_bp.register_blueprint(agent_bp)
api_bp.register_blueprint(remote_execution_bp)
api_bp.register_blueprint(workflow_bp)
api_bp.register_blueprint(commerce_intel_bp)
api_bp.register_blueprint(ops_insight_bp)
api_bp.register_blueprint(store_access_bp)
api_bp.register_blueprint(amazon_rank_bp)
api_bp.register_blueprint(amazon_shipment_bp)
api_bp.register_blueprint(proxy_pool_bp)
api_bp.register_blueprint(agent_access_bp)


@api_bp.route("/csrf-bootstrap")
def csrf_bootstrap():
    """供 SPA 开发代理拉取 HTML 中的 ``csrf-token`` meta，不包含业务页面。"""
    token = html_escape(generate_csrf())
    body = (
        "<!DOCTYPE html><html><head>"
        f'<meta name="csrf-token" content="{token}">'
        "</head><body></body></html>"
    )
    return body, 200, {"Content-Type": "text/html; charset=utf-8"}


def _pricing_owner_user_id() -> int | None:
    actor = session_user() or {}
    if str(actor.get("role") or "") == "superuser":
        return None
    try:
        return int(actor.get("id") or 0)
    except (TypeError, ValueError):
        return 0


def _pricing_record_for_sop(filename: str | None):
    if not filename:
        return None
    db = get_db()
    if not getattr(db, "is_available", False):
        return None
    return db.get_pricing_record_by_sop_file(
        filename,
        owner_user_id=_pricing_owner_user_id(),
    )


def _resolve_pricing_sop(filename: str | None = None):
    db = get_db()
    if filename:
        record = _pricing_record_for_sop(filename)
        return (resolve_sop_file(filename), record) if record else (None, None)
    records = db.get_pricing_records(limit=100, owner_user_id=_pricing_owner_user_id())
    for record in records:
        name = str(record.get("sop_file_name") or "").strip()
        target = resolve_sop_file(name) if name else None
        if target:
            return target, record
    return None, None


def resolve_sheet_name(sheet_names, target_name):
    if target_name in sheet_names:
        return target_name

    normalized_target = target_name.replace(" ", "")
    for sheet_name in sheet_names:
        if sheet_name.replace(" ", "") == normalized_target:
            return sheet_name
    return None


def build_preview_payload(file_path):
    excel_data = {"summary": [], "sop": []}

    with pd.ExcelFile(file_path) as workbook:
        summary_sheet = resolve_sheet_name(workbook.sheet_names, "定价汇总")
        sop_sheet = resolve_sheet_name(workbook.sheet_names, "定价SOP流程表")

        if summary_sheet:
            summary_df = pd.read_excel(workbook, sheet_name=summary_sheet)
            for _, row in summary_df.iterrows():
                if len(row) >= 2 and pd.notna(row.iloc[0]) and pd.notna(row.iloc[1]):
                    key = str(row.iloc[0])
                    if key == "产品阶段":
                        continue
                    value = str(row.iloc[1])
                    if (
                        "阶段" in key
                        and len(row) >= 5
                        and all(pd.notna(row.iloc[i]) for i in range(1, 5))
                    ):
                        value = (
                            f"SP {row.iloc[1]} / Coupon {row.iloc[2]} / "
                            f"DP {row.iloc[3]} / 预计单件盈亏 {row.iloc[4]}"
                        )
                    excel_data["summary"].append(
                        {
                            "key": key,
                            "value": value,
                        }
                    )

        if sop_sheet:
            sop_df = pd.read_excel(workbook, sheet_name=sop_sheet)
            for index, row in sop_df.iterrows():
                if len(row) >= 4 and pd.notna(row.iloc[0]) and index > 0:
                    excel_data["sop"].append(
                        {
                            "step": str(row.iloc[0]),
                            "operation": str(row.iloc[1]) if pd.notna(row.iloc[1]) else "",
                            "reason": str(row.iloc[2]) if pd.notna(row.iloc[2]) else "",
                            "check": str(row.iloc[3]) if pd.notna(row.iloc[3]) else "",
                        }
                    )

    return excel_data


@api_bp.route("/health")
def health():
    return json_success(data={"status": "ok", "version": APP_VERSION})


@api_bp.route("/ready")
def ready():
    try:
        database = get_db()
        if not database.ping():
            return json_error("数据库未就绪", status=503)
        return json_success(data={"status": "ready", "database": "ok"})
    except Exception:
        return json_error("数据库未就绪", status=503)


@api_bp.route("/download")
def download():
    filename = (request.args.get("file") or "").strip() or None
    target, _record = _resolve_pricing_sop(filename)
    if not target:
        return json_error("文件不存在，请先生成 SOP", status=404)

    return send_file(
        target,
        as_attachment=True,
        download_name=target.name if filename else "定价SOP.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@api_bp.route("/pricing-sop/history", methods=["GET"])
def pricing_sop_history():
    try:
        limit = min(max(int(request.args.get("limit", 50)), 1), 200)
    except (TypeError, ValueError):
        limit = 50
    db = get_db()
    items = list_sop_history(db=db, limit=limit, owner_user_id=_pricing_owner_user_id())
    latest = items[0]["filename"] if items else None
    return json_success(data={"items": json_safe_list(items), "latest_file": latest})


@api_bp.route("/pricing-sop/simulate", methods=["POST"])
def pricing_sop_simulate():
    """
    按历史 SOP 试算盈亏。body: { filename|record_id, trial_price?, price_kind: dp|sp }
    无 trial_price 时仅返回锚点与预设方案对比；有 trial_price 时追加 trial 明细。
    """
    body = request.get_json(silent=True) or {}
    filename = (body.get("filename") or "").strip() or None
    record_id = body.get("record_id")
    price_kind = (body.get("price_kind") or "dp").strip().lower()
    trial_raw = body.get("trial_price")
    trial_price = None
    if trial_raw is not None and trial_raw != "":
        try:
            trial_price = float(trial_raw)
        except (TypeError, ValueError):
            return json_error("trial_price 须为数字", status=400)

    if not filename and record_id is None:
        return json_error("请提供 filename 或 record_id", status=400)
    if filename:
        rec = _pricing_record_for_sop(filename)
        if not rec:
            return json_error("定价记录不存在", status=404)
        record_id = rec.get("id")
        filename = None
    if record_id is not None:
        rec = get_db().get_pricing_record_by_id(
            record_id,
            owner_user_id=_pricing_owner_user_id(),
        )
        if not rec:
            return json_error("定价记录不存在", status=404)

    try:
        data = simulate_pricing(
            get_db(),
            filename=filename,
            record_id=record_id,
            trial_price=trial_price,
            price_kind=price_kind,
        )
        return json_success(data=data)
    except PricingSimulateError as exc:
        return json_error(str(exc), status=400)
    except Exception as error:
        return json_error(f"试算失败：{error}", status=500)


@api_bp.route("/exchange-rates/boc", methods=["GET"])
def boc_exchange_rates():
    """
    中国银行外汇牌价（美元/欧元/日元）及换算示例。
    查询参数：
      - refresh=1  跳过缓存强制抓取
      - amount_rmb  人民币数量，默认 1（换算为外币）
      - amount_foreign  外币数量，默认 100（换算为人民币，与牌价「每百单位」口径一致）
    """
    try:
        refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
        try:
            amount_rmb = float(request.args.get("amount_rmb", 1))
        except (TypeError, ValueError):
            amount_rmb = 1.0
        try:
            amount_foreign = float(request.args.get("amount_foreign", 100))
        except (TypeError, ValueError):
            amount_foreign = 100.0

        svc = BocExchangeRateService()
        result = svc.get_snapshot(
            amount_rmb=amount_rmb,
            amount_foreign=amount_foreign,
            use_cache=not refresh,
        )
        if result.get("success") is False:
            return json_error(result.get("message", "无法获取中行外汇牌价"), status=502)
        return json_success(data=result)
    except Exception as error:
        return json_error(f"获取中行牌价失败：{error}", status=500)


@api_bp.route("/get-exchange-rate", methods=["GET"])
def get_exchange_rate_fallback():
    """第三方汇率兜底（仅在中行牌价失败时由前端调用）。"""
    try:
        currency = request.args.get("currency", "USD").upper()
        result = ExchangeRateFallbackService().get_exchange_rate(currency)
        if result.get("success"):
            return jsonify(result)
        return json_error(result.get("message", "获取汇率失败"), status=502)
    except Exception as error:
        return json_error(f"请求过程中出错：{error}", status=500)


@api_bp.route("/calculate", methods=["POST"])
def calculate():
    try:
        data = request.form.to_dict()
        pricing_service = PricingService()
        result = pricing_service.calculate_pricing(
            data,
            owner_user_id=_pricing_owner_user_id(),
        )

        # 成功或「已出表但未过红线」等均返回 200 + JSON，避免 body 内 code 被误当作 HTTP 状态
        if result.get("success") or result.get("partial_success"):
            return jsonify(result)
        return json_error(result.get("message", "计算失败"), status=result.get("code", 400))
    except Exception as error:
        return json_error(f"计算过程中出错：{error}", status=500)


@api_bp.route("/preview-excel")
def preview_excel():
    """返回指定或最新定价 SOP Excel 的结构化预览。无文件时仍 200 + 空数据（供 SPA 首屏拉取）。"""
    try:
        filename = (request.args.get("file") or "").strip() or None
        target, _record = _resolve_pricing_sop(filename)
        if not target:
            return json_success(
                message="暂无已生成的 SOP，请先完成一次定价计算",
                data={"summary": [], "sop": [], "filename": None},
            )
        preview_data = build_preview_payload(target)
        preview_data["filename"] = target.name
        return json_success(data=preview_data)
    except Exception as error:
        return json_error(f"预览过程中出错：{error}", status=500)
