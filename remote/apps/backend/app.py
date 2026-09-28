import os
import sys
import hmac

from flask import Flask, jsonify, request

from api.routes import api_bp
from datetime import timedelta

from config.settings import (
    APP_DESCRIPTION,
    APP_NAME,
    APP_SESSION_DAYS,
    AMAZON_SHIPMENT_INTERNAL_TOKEN,
    DEBUG,
    DEBUG_USE_RELOADER,
    HOST,
    PORT,
    SECRET_KEY,
    TASK_SCHEDULER_ENABLED,
    TASK_WORKER_ENABLED,
    REMOTE_EXECUTION_ENABLED,
    WORKFLOW_CENTER_ENABLED,
    CROSSBORDEROPS_INTERNAL_TOKEN,
)
from database.database import Database
from extensions import csrf
from integrations.llm import build_llm_client


def clear_terminal_on_startup() -> None:
    """与 Node 脚本 ``clear-terminal.mjs`` 相同：清屏 + 清滚动缓冲 + 光标回左上角。"""
    # 与 process.stdout.write('\\x1B[2J\\x1B[3J\\x1B[H') 等价
    seq = "\x1b[2J\x1b[3J\x1b[H"
    if os.name == "nt":
        # 部分 Windows 控制台需先启用 ANSI（与旧版 cmd 兼容）
        os.system("")
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream.isatty():
                stream.write(seq)
                stream.flush()
        except OSError:
            pass


def register_error_handlers(app):
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({"success": False, "message": "请求的资源不存在", "code": 404}), 404

    @app.errorhandler(500)
    def server_error(error):
        return jsonify({"success": False, "message": "服务器内部错误", "code": 500}), 500


def register_access_guard(app):
    @app.before_request
    def _guard_feature_and_site_access():
        path = request.path or ""
        if request.method == "OPTIONS":
            return None
        if (path == "/remote-execution" or path.startswith("/remote-execution/")) and not REMOTE_EXECUTION_ENABLED:
            return json_disabled_feature("远程执行功能当前已停用")
        if (path == "/workflows" or path.startswith("/workflows/")) and not WORKFLOW_CENTER_ENABLED:
            return json_disabled_feature("Workflow 中心当前已停用")
        if path in {"/health", "/ready", "/csrf-bootstrap"}:
            return None
        if path.startswith("/auth/login") or path.startswith("/auth/logout") or path.startswith("/auth/me"):
            return None
        if path.startswith("/auth/users"):
            return None
        if path.startswith("/remote-execution/agent/"):
            return None
        if path.startswith("/workflows/releases/") and path.endswith("/source-bundle"):
            return None
        if (
            path == "/amazon-shipments/compat"
            and AMAZON_SHIPMENT_INTERNAL_TOKEN
            and hmac.compare_digest(
                request.headers.get("X-CrossBorderOps-Internal-Token", ""),
                AMAZON_SHIPMENT_INTERNAL_TOKEN,
            )
        ):
            return None
        if (
            path.startswith("/agent-access/effective-scope/")
            and CROSSBORDEROPS_INTERNAL_TOKEN
            and hmac.compare_digest(
                request.headers.get("X-CrossBorderOps-Internal-Token", ""),
                CROSSBORDEROPS_INTERNAL_TOKEN,
            )
        ):
            return None
        if (
            path == "/agent-access/query"
            and CROSSBORDEROPS_INTERNAL_TOKEN
            and hmac.compare_digest(
                request.headers.get("X-CrossBorderOps-Internal-Token", ""),
                CROSSBORDEROPS_INTERNAL_TOKEN,
            )
        ):
            return None

        try:
            from api.auth_session import get_auth_service, session_user
            from api.common import json_error
            from services.access_control import feature_for_api_path, has_feature_access, is_site_allowed

            auth = get_auth_service()
            if not auth.is_auth_enabled():
                return None
            user = session_user()
            if not user:
                return json_error("请先登录", status=401)
            feature = feature_for_api_path(path)
            if feature and not has_feature_access(user, feature):
                return json_error("无权限访问该功能", status=403)
            site = _request_site_param()
            if site and not is_site_allowed(user, site):
                return json_error("无权限访问该站点数据", status=403)
        except Exception as error:
            app.logger.exception("权限守卫检查失败，已拒绝请求：%s", error)
            return json_error("权限校验暂时不可用，请稍后重试", status=503)
        return None


def json_disabled_feature(message: str):
    from api.common import json_error

    return json_error(message, status=410)


def _request_site_param() -> str | None:
    for key in ("site", "marketplace", "country", "amazon_site"):
        value = request.args.get(key)
        if value:
            return value
    if request.is_json:
        body = request.get_json(silent=True) or {}
        for key in ("site", "marketplace", "country", "amazon_site"):
            value = body.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def initialize_database(app):
    """触发表结构就绪：``Database()`` 构造时已执行一次 ``init_db()``（见 ``database/database.py``）。"""
    database = Database()
    if not database.is_available:
        app.logger.warning("未配置 DATABASE_URL，已跳过数据库初始化")
        return
    app.logger.info("数据库已连接，表结构已由 models.create_table 初始化（非独立迁移进程）")


def initialize_auth(app):
    """确保用户表存在，并在空库时创建默认超级用户。"""
    try:
        from services.auth_service import AuthService

        svc = AuthService()
        if not svc.is_available:
            if svc.is_auth_enabled():
                app.logger.warning("已启用登录但未配置 DATABASE_URL，将使用 .env 单账号模式")
            return
        svc.ensure_schema()
        created = svc.ensure_default_superuser()
        if created:
            app.logger.warning(
                "已创建默认超级用户：账号=%s，展示名=%s（请尽快修改 APP_SUPERUSER_PASSWORD 并重启）",
                created["username"],
                created["display_name"],
            )
        elif svc.is_auth_enabled():
            app.logger.info("登录校验已启用（系统用户数：%s）", svc.count_users())
    except Exception as error:
        app.logger.warning("认证初始化失败：%s", error)


def initialize_llm(app):
    """加载插件注册表、确保 LLM 配置表存在，并预热解析。"""
    try:
        from integrations.llm.plugins.registry import get_registry
        from services.llm_config_service import LlmConfigService

        registry = get_registry()
        app.logger.info("LLM 插件已加载: %s", ", ".join(p.meta.code for p in registry.list_plugins()))

        svc = LlmConfigService()
        if svc.is_available:
            svc.ensure_schema()
        build_llm_client("global_default")
        app.logger.info("LLM 配置框架初始化完成（数据源：数据库）")
    except Exception as error:
        app.logger.warning(f"LLM 初始化检查失败：{error}")


def initialize_dingtalk(app):
    """确保钉钉配置表存在。"""
    try:
        from services.dingtalk_config_service import DingTalkConfigService

        svc = DingTalkConfigService()
        if svc.is_available:
            svc.ensure_schema()
            app.logger.info("钉钉通知配置表已就绪（数据源：数据库）")
    except Exception as error:
        app.logger.warning("钉钉配置初始化检查失败：%s", error)


def initialize_agent_runtime(app):
    """Ensure LangGraph Agent event projection tables exist."""
    try:
        from agents.runtime import LangGraphAgentRuntime

        svc = LangGraphAgentRuntime()
        if svc.is_available:
            svc.ensure_schema()
            app.logger.info("LangGraph Agent 表结构已就绪（thread/event/store 投影）")
    except Exception as error:
        app.logger.warning("LangGraph Agent 初始化检查失败：%s", error)


def initialize_remote_execution(app):
    """Ensure remote execution node/event/artifact tables exist."""
    if not REMOTE_EXECUTION_ENABLED:
        app.logger.info("远程执行功能已停用，跳过节点初始化")
        return
    try:
        from services.remote_execution_service import RemoteExecutionService

        svc = RemoteExecutionService()
        if svc.is_available:
            svc.ensure_schema()
            app.logger.info("远程执行节点表结构已就绪")
    except Exception as error:
        app.logger.warning("远程执行初始化失败：%s", error)


def _configure_json_utf8(app: Flask) -> None:
    """Flask 2.3+ 用 JSONProvider；旧版用 JSON_AS_ASCII。二者都设，并声明 charset。"""
    app.config["JSON_AS_ASCII"] = False
    json_provider = getattr(app, "json", None)
    if json_provider is not None and hasattr(json_provider, "ensure_ascii"):
        json_provider.ensure_ascii = False

    @app.after_request
    def _json_charset_utf8(response):
        ct = response.content_type or ""
        if ct.startswith("application/json") and "charset=" not in ct.lower():
            response.headers["Content-Type"] = "application/json; charset=utf-8"
        return response


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=SECRET_KEY,
        APP_NAME=APP_NAME,
        APP_DESCRIPTION=APP_DESCRIPTION,
        WTF_CSRF_TIME_LIMIT=None,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(days=APP_SESSION_DAYS),
    )
    _configure_json_utf8(app)

    csrf.init_app(app)
    app.register_blueprint(api_bp)

    register_error_handlers(app)
    register_access_guard(app)
    initialize_database(app)
    initialize_auth(app)
    initialize_llm(app)
    initialize_dingtalk(app)
    initialize_agent_runtime(app)
    initialize_remote_execution(app)
    initialize_task_queue(app)
    return app


def _embedded_task_process_allowed() -> bool:
    """Flask debug reloader 父进程不启动 Worker/Scheduler，避免双份 LISTEN 与重复日志。"""
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        return True
    return not (DEBUG and DEBUG_USE_RELOADER)


def initialize_task_queue(app):
    """启动嵌入式任务 Worker 与 APScheduler（由 .env 开关控制）。"""
    if not _embedded_task_process_allowed():
        app.logger.debug("跳过任务队列启动（Flask reloader 监视进程）")
        return
    try:
        from tasks.queue_service import TaskQueueService

        svc = TaskQueueService()
        if svc.is_available:
            svc.ensure_tables()
        if TASK_WORKER_ENABLED:
            from tasks.worker import start_worker

            start_worker()
            app.logger.info("任务 Worker 已启用 (TASK_WORKER_ENABLED=true)")
        try:
            from integrations.dingtalk.stream_listener import start_dingtalk_stream

            start_dingtalk_stream()
        except Exception as stream_error:
            app.logger.warning("钉钉 Stream 启动失败：%s", stream_error)
        if TASK_SCHEDULER_ENABLED:
            from tasks.scheduler import start_scheduler

            start_scheduler()
            app.logger.info("定时调度器已启用 (TASK_SCHEDULER_ENABLED=true)")
    except Exception as error:
        app.logger.warning("任务队列初始化失败：%s", error)


app = create_app()


if __name__ == "__main__":
    _use_reloader = bool(DEBUG and DEBUG_USE_RELOADER)
    # 开发重载：仅在真正提供服务的子进程清屏，避免父进程先清屏再打印 * Restarting *
    if (not _use_reloader) or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        clear_terminal_on_startup()
    app.run(
        host=HOST,
        port=PORT,
        debug=DEBUG,
        use_reloader=_use_reloader,
        threaded=True,  # 支持 SSE 长连接与普通请求并发（任务中心实时流依赖此项）
    )
