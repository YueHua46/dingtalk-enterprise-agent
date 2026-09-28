import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
_configured_env_file = os.getenv("CBOPS_ENV_FILE", "").strip()
load_dotenv(Path(_configured_env_file) if _configured_env_file else BASE_DIR / ".env")

CBOPS_ENVIRONMENT = os.getenv("CBOPS_ENVIRONMENT", "production").strip().lower() or "production"
DEV_EXTERNAL_MODE = os.getenv("DEV_EXTERNAL_MODE", "disabled").strip().lower() or "disabled"


def get_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


DEV_EXTERNAL_WRITES_ENABLED = get_bool("DEV_EXTERNAL_WRITES_ENABLED", False)


APP_NAME = os.getenv("APP_NAME", "亚马逊跨境电商智能工具平台")
APP_DESCRIPTION = os.getenv("APP_DESCRIPTION", "面向亚马逊运营团队的定价、广告与分析工作台")
APP_VERSION = os.getenv("APP_VERSION", "1.1.0")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")

# 前端登录（APP_LOGIN_ENABLED=false 可关闭；有 DB 用户或 APP_LOGIN_PASSWORD 时生效）
APP_LOGIN_ENABLED = get_bool("APP_LOGIN_ENABLED", True)
APP_LOGIN_USERNAME = os.getenv("APP_LOGIN_USERNAME", "admin").strip() or "admin"
APP_LOGIN_PASSWORD = os.getenv("APP_LOGIN_PASSWORD", "").strip()
APP_SESSION_DAYS = int(os.getenv("APP_SESSION_DAYS", "7"))
APP_SUPERUSER_USERNAME = os.getenv("APP_SUPERUSER_USERNAME", APP_LOGIN_USERNAME).strip() or "admin"
APP_SUPERUSER_PASSWORD = os.getenv(
    "APP_SUPERUSER_PASSWORD",
    APP_LOGIN_PASSWORD or "CrossBorderOps@2026",
).strip()
APP_SUPERUSER_DISPLAY_NAME = os.getenv("APP_SUPERUSER_DISPLAY_NAME", "赵琳").strip() or "赵琳"

# DingTalk identity and server-to-server authorization bridge. Secrets remain in .env.
DINGTALK_CORP_ID = os.getenv("DINGTALK_CORP_ID", "").strip()
CROSSBORDEROPS_INTERNAL_TOKEN = os.getenv("CROSSBORDEROPS_INTERNAL_TOKEN", "").strip()
DINGTALK_DIRECTORY_APP_KEY = os.getenv("DINGTALK_DIRECTORY_APP_KEY", "").strip()
DINGTALK_DIRECTORY_APP_SECRET = os.getenv("DINGTALK_DIRECTORY_APP_SECRET", "").strip()
DINGTALK_DIRECTORY_FACTORY_DEPT_ID = int(os.getenv("DINGTALK_DIRECTORY_FACTORY_DEPT_ID", "0") or 0)

# 暂停使用远程 Agent / Workflow 中心时保持为 False。保留环境开关，恢复时无需改数据库结构。
WORKFLOW_CENTER_ENABLED = get_bool("WORKFLOW_CENTER_ENABLED", False)
REMOTE_EXECUTION_ENABLED = get_bool("REMOTE_EXECUTION_ENABLED", False)

# 全局 HTTP 代理（SIF / 竞品采集 / LLM 共用；LLM 仅在设置页勾选「走代理」时启用，地址不可按档案修改）
PROXY = os.getenv("PROXY", "http://127.0.0.1:7890").strip()

# Amazon 广告/自然排名：默认仅美国站在直连预检失败后切换到系统代理。
# 可用逗号分隔扩展站点；代理留空时保持纯直连。
AMAZON_RANK_PROXY = os.getenv("AMAZON_RANK_PROXY", PROXY).strip()
AMAZON_RANK_PROXY_MARKETPLACES = {
    item.strip().upper()
    for item in os.getenv("AMAZON_RANK_PROXY_MARKETPLACES", "US").split(",")
    if item.strip()
}
AMAZON_RANK_KEYWORD_MAX_CONCURRENT = max(
    1, min(int(os.getenv("AMAZON_RANK_KEYWORD_MAX_CONCURRENT", "5")), 20)
)

# 服务器配置
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "5000"))
DEBUG = get_bool("DEBUG", True)
# Windows 下 Flask debug 自动热重载易导致 WinError 10038（套接字无效）；需要监听文件重载时再设为 True
DEBUG_USE_RELOADER = get_bool("DEBUG_USE_RELOADER", False)

# 数据库配置
DATABASE_URL = os.getenv("DATABASE_URL")
AMAZON_DAILY_REGISTRATION_URL = os.getenv(
    "AMAZON_DAILY_REGISTRATION_URL",
    "postgresql://postgres:123456@192.168.3.75:5432/amazon_daily_registration",
)
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "10"))

# 缓存配置
CACHE_EXPIRY = int(os.getenv("CACHE_EXPIRY", "3600"))

# 文件路径配置
OUTPUT_DIR = BASE_DIR / "生成的SOP"
MONITORING_OUTPUT_DIR = BASE_DIR / "竞品监控输出"
DAILY_REPORT_OUTPUT_DIR = OUTPUT_DIR / "daily_reports"
# 竞品 Excel 由 domain/competitor/exporter.py 程序化生成，无需外部模板
SKILLS_DIR = BASE_DIR / "skills"
SOP_SKILL_DIR = SKILLS_DIR / "sop-generator"

for directory in (OUTPUT_DIR, MONITORING_OUTPUT_DIR, DAILY_REPORT_OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

USER_AVATAR_DIR = BASE_DIR / "data" / "user_avatars"
USER_AVATAR_DIR.mkdir(parents=True, exist_ok=True)

# Remote execution Agent artifacts. Production may later swap this local
# storage behind the same API for S3/MinIO.
REMOTE_EXECUTION_ARTIFACT_DIR = Path(
    os.getenv("REMOTE_EXECUTION_ARTIFACT_DIR", BASE_DIR / "data" / "task_artifacts")
).expanduser()
REMOTE_EXECUTION_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

REMOTE_EXECUTION_SCREENSHOT_DIR = Path(
    os.getenv("REMOTE_EXECUTION_SCREENSHOT_DIR", BASE_DIR / "data" / "remote_screenshots")
).expanduser()
REMOTE_EXECUTION_SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

# 竞品 Amazon 页面证据：原始 HTML + 与该 HTML 对应的整页截图。
COMPETITOR_PAGE_EVIDENCE_DIR = Path(
    os.getenv("COMPETITOR_PAGE_EVIDENCE_DIR", BASE_DIR / "data" / "competitor_page_evidence")
).expanduser()
COMPETITOR_PAGE_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
COMPETITOR_PAGE_EVIDENCE_KEEP_BATCHES = max(
    1, min(int(os.getenv("COMPETITOR_PAGE_EVIDENCE_KEEP_BATCHES", "7")), 30)
)

# 竞品自然关键词突降证据：与 Listing/评论页面证据完全隔离。
COMPETITOR_RANK_DROP_EVIDENCE_DIR = Path(
    os.getenv(
        "COMPETITOR_RANK_DROP_EVIDENCE_DIR",
        BASE_DIR / "data" / "competitor_rank_drop_evidence",
    )
).expanduser()
COMPETITOR_RANK_DROP_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

WORKFLOW_SOURCE_BUNDLE_DIR = Path(
    os.getenv("WORKFLOW_SOURCE_BUNDLE_DIR", BASE_DIR / "data" / "workflow_bundles")
).expanduser()
WORKFLOW_SOURCE_BUNDLE_DIR.mkdir(parents=True, exist_ok=True)

WORKFLOW_BUILD_DIR = Path(
    os.getenv("WORKFLOW_BUILD_DIR", BASE_DIR / "data" / "workflow_builds")
).expanduser()
WORKFLOW_BUILD_DIR.mkdir(parents=True, exist_ok=True)

# 卖家精灵配置
SELLER_SPRITE_EMAIL = os.getenv("SELLER_SPRITE_EMAIL", "")
SELLER_SPRITE_PASSWORD = os.getenv("SELLER_SPRITE_PASSWORD", "")
SELLER_SPRITE_COMPETING_MARKET = os.getenv("SELLER_SPRITE_COMPETING_MARKET", "US")
SELLER_SPRITE_KEYWORD_MARKET = os.getenv("SELLER_SPRITE_KEYWORD_MARKET", "COM")
SELLER_SPRITE_KEYWORD_MAX_PAGES = int(os.getenv("SELLER_SPRITE_KEYWORD_MAX_PAGES", "5"))
SELLER_SPRITE_KEYWORD_MAX_WORKERS = max(
    1, int(os.getenv("SELLER_SPRITE_KEYWORD_MAX_WORKERS", "2"))
)
# 卖家精灵 AI 找竞品使用网页版 /v3/api 会话；触发验证码时可临时配置
# SELLERSPRITE_COOKIE 复用浏览器登录态。
SELLER_SPRITE_AI_DEFAULT_QUANTITY = max(1, int(os.getenv("SELLER_SPRITE_AI_DEFAULT_QUANTITY", "20")))
SELLER_SPRITE_AI_POLL_INTERVAL_SEC = max(1.0, float(os.getenv("SELLER_SPRITE_AI_POLL_INTERVAL_SEC", "3.0")))
SELLER_SPRITE_AI_TIMEOUT_SEC = max(30.0, float(os.getenv("SELLER_SPRITE_AI_TIMEOUT_SEC", "600.0")))
SELLER_SPRITE_LIFECYCLE_MAX_ASINS = max(1, int(os.getenv("SELLER_SPRITE_LIFECYCLE_MAX_ASINS", "20")))

# 知无不言登录配置。数据库中的后台设置优先；环境变量仅作首次配置兜底。
WEARESELLERS_USERNAME = os.getenv("WEARESELLERS_USERNAME", "").strip()
WEARESELLERS_PASSWORD = os.getenv("WEARESELLERS_PASSWORD", "").strip()

# SerpApi Google Trends（竞品调研市场趋势）。真实请求必须配置私钥；不要提交到仓库。
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", os.getenv("SERP_API_KEY", "")).strip()
SERPAPI_TIMEOUT_SEC = max(5.0, float(os.getenv("SERPAPI_TIMEOUT_SEC", "30.0")))

# 领星 OpenAPI（广告报表同步）
LINGXING_APP_ID = os.getenv("LINGXING_APP_ID", "").strip()
LINGXING_APP_SECRET = os.getenv("LINGXING_APP_SECRET", "").strip()
LINGXING_API_BASE = os.getenv("LINGXING_API_BASE", "https://openapi.lingxing.com").strip().rstrip("/")
LINGXING_SYNC_MAX_DAYS = int(os.getenv("LINGXING_SYNC_MAX_DAYS", "62"))

# Amazon FBA 发货单自动创建。默认关闭真实写入，迁移灰度期间由环境变量显式开启。
AMAZON_SHIPMENT_ENABLED = get_bool("AMAZON_SHIPMENT_ENABLED", False)
AMAZON_SHIPMENT_LIVE_CREATE = get_bool("AMAZON_SHIPMENT_LIVE_CREATE", False)
AMAZON_SHIPMENT_SHARE_ROOT = Path(
    os.getenv(
        "AMAZON_SHIPMENT_SHARE_ROOT",
        "/mnt/office/RPA/运营&助理/亚马逊自动创建发货单",
    )
)
AMAZON_SHIPMENT_TEMPLATE_FILE = Path(
    os.getenv(
        "AMAZON_SHIPMENT_TEMPLATE_FILE",
        str(AMAZON_SHIPMENT_SHARE_ROOT / "商务助理表格_模板.xlsx"),
    )
)
AMAZON_SHIPMENT_WAREHOUSE_WID = int(os.getenv("AMAZON_SHIPMENT_WAREHOUSE_WID", "261"))
AMAZON_SHIPMENT_DEFAULT_SID = os.getenv("AMAZON_SHIPMENT_DEFAULT_SID", "7446").strip()
AMAZON_SHIPMENT_INTERNAL_TOKEN = os.getenv("AMAZON_SHIPMENT_INTERNAL_TOKEN", "").strip()
AMAZON_SHIPMENT_COOKIE_FILE = Path(
    os.getenv(
        "LINGXING_WEB_COOKIES_JSON",
        BASE_DIR / "data" / "lingxing" / "cookies.json",
    )
)
AMAZON_SHIPMENT_ARTIFACT_DIR = Path(
    os.getenv("AMAZON_SHIPMENT_ARTIFACT_DIR", BASE_DIR / "data" / "amazon_shipment")
)
AMAZON_SHIPMENT_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

# SIF（www.sif.com）ASIN 反查关键词：凭证务必写入 .env，勿提交仓库
SIF_BASE_URL = os.getenv("SIF_BASE_URL", "https://www.sif.com").strip().rstrip("/")
SIF_PHONE = os.getenv("SIF_PHONE", "").strip()
SIF_PASSWORD = os.getenv("SIF_PASSWORD", "").strip()
SIF_TOKEN = os.getenv("SIF_TOKEN", "").strip()
SIF_TOKEN_CACHE = os.getenv("SIF_TOKEN_CACHE", "").strip()
# 可选：仅 SIF 请求走代理；留空则复用全局 PROXY（如有）
SIF_HTTP_PROXY = os.getenv("SIF_HTTP_PROXY", "").strip()
# 竞品采集顺带写入 SIF 关键词时使用的站点与时间片（与 SIF 反查导出一致）
SIF_AUTO_SYNC_COUNTRY = os.getenv("SIF_AUTO_SYNC_COUNTRY", "US").strip().upper() or "US"
SIF_AUTO_SYNC_TIME_PIECE_TYPE = os.getenv("SIF_AUTO_SYNC_TIME_PIECE_TYPE", "latelyDay").strip() or "latelyDay"
SIF_AUTO_SYNC_TIME_PIECE_VALUE = os.getenv("SIF_AUTO_SYNC_TIME_PIECE_VALUE", "7").strip() or "7"

# SIF 反查关键词 → 广告框架词库（①）：入库成功后自动镜像，运营再在框架表里打标签
AD_FRAMEWORK_MIRROR_FROM_SIF = get_bool("AD_FRAMEWORK_MIRROR_FROM_SIF", True)
# 入库时启发式分类（规则推断框架分层/词类/颜色防水等；非 GPT）
AD_FRAMEWORK_AUTO_CLASSIFY = get_bool("AD_FRAMEWORK_AUTO_CLASSIFY", True)
# 英文竞品品牌片段，逗号分隔，命中则分为「竞品截流」
AD_FRAMEWORK_COMPETITOR_BRANDS = os.getenv(
    "AD_FRAMEWORK_COMPETITOR_BRANDS",
    "furbo,aosu,blurams,ring,eufy,reolink,wyze,blink,arlo,google nest",
).strip()
# 自有品牌（命中则「品牌防御」）；留空则不判
AD_FRAMEWORK_OWN_BRAND = os.getenv("AD_FRAMEWORK_OWN_BRAND", "").strip()
# 再次同步时若库里该行已改为非「未分类」，保留手工分类
AD_FRAMEWORK_PRESERVE_MANUAL_CLASSIFY = get_bool("AD_FRAMEWORK_PRESERVE_MANUAL_CLASSIFY", True)
# LLM 批量打标签（广告框架词库）：单次请求最多 id 数（前端会按此分批）；硬上限防超时
_AD_FRAMEWORK_LLM_MAX_IDS_RAW = int(os.getenv("AD_FRAMEWORK_LLM_MAX_IDS_PER_REQUEST", "25"))
AD_FRAMEWORK_LLM_MAX_IDS_PER_REQUEST = max(1, min(_AD_FRAMEWORK_LLM_MAX_IDS_RAW, 80))
AD_FRAMEWORK_LLM_DEFAULT_THEME_HINT = os.getenv("AD_FRAMEWORK_LLM_DEFAULT_THEME_HINT", "").strip()

# 竞品监控增强采集配置
COMPETITOR_ENABLE_US_NATURAL_RANK = get_bool("COMPETITOR_ENABLE_US_NATURAL_RANK", True)
COMPETITOR_US_RANK_MAX_PAGES = int(os.getenv("COMPETITOR_US_RANK_MAX_PAGES", "8"))
COMPETITOR_RANK_RECHECK_DELAY_HOURS = max(
    1,
    min(int(os.getenv("COMPETITOR_RANK_RECHECK_DELAY_HOURS", "2")), 24),
)
COMPETITOR_RANK_RECHECK_MAX_ATTEMPTS = max(
    1,
    min(int(os.getenv("COMPETITOR_RANK_RECHECK_MAX_ATTEMPTS", "3")), 3),
)
COMPETITOR_RANK_RECHECK_MAX_PAGES = max(
    1,
    min(
        max(
            COMPETITOR_US_RANK_MAX_PAGES,
            int(os.getenv("COMPETITOR_RANK_RECHECK_MAX_PAGES", "15")),
        ),
        20,
    ),
)
COMPETITOR_US_RANK_TIMEOUT_SEC = int(os.getenv("COMPETITOR_US_RANK_TIMEOUT_SEC", "20"))
COMPETITOR_US_RANK_SLEEP_SEC = float(os.getenv("COMPETITOR_US_RANK_SLEEP_SEC", "0.8"))
# 搜索排名抓取并发过高易触发 503；全局信号量上限（跨 ASIN、跨线程）
COMPETITOR_US_RANK_MAX_CONCURRENT = max(
    1, int(os.getenv("COMPETITOR_US_RANK_MAX_CONCURRENT", "2"))
)
AMAZON_SEARCH_RANK_REQUIRED_VALID_SAMPLES = max(
    2,
    min(
        int(
            os.getenv(
                "AMAZON_SEARCH_RANK_REQUIRED_VALID_SAMPLES",
                os.getenv("COMPETITOR_RANK_REQUIRED_VALID_SAMPLES", "3"),
            )
        ),
        5,
    ),
)
AMAZON_SEARCH_RANK_MAX_SAMPLE_ATTEMPTS = max(
    AMAZON_SEARCH_RANK_REQUIRED_VALID_SAMPLES,
    min(
        int(
            os.getenv(
                "AMAZON_SEARCH_RANK_MAX_SAMPLE_ATTEMPTS",
                os.getenv("COMPETITOR_RANK_MAX_SAMPLE_ATTEMPTS", "5"),
            )
        ),
        8,
    ),
)
AMAZON_SEARCH_RANK_SAMPLE_JITTER_MIN_SEC = max(
    0.0,
    float(
        os.getenv(
            "AMAZON_SEARCH_RANK_SAMPLE_JITTER_MIN_SEC",
            os.getenv("COMPETITOR_RANK_SAMPLE_JITTER_MIN_SEC", "1.0"),
        )
    ),
)
AMAZON_SEARCH_RANK_SAMPLE_JITTER_MAX_SEC = max(
    AMAZON_SEARCH_RANK_SAMPLE_JITTER_MIN_SEC,
    float(
        os.getenv(
            "AMAZON_SEARCH_RANK_SAMPLE_JITTER_MAX_SEC",
            os.getenv("COMPETITOR_RANK_SAMPLE_JITTER_MAX_SEC", "3.0"),
        )
    ),
)
COMPETITOR_RANK_REQUIRED_VALID_SAMPLES = AMAZON_SEARCH_RANK_REQUIRED_VALID_SAMPLES
COMPETITOR_RANK_MAX_SAMPLE_ATTEMPTS = AMAZON_SEARCH_RANK_MAX_SAMPLE_ATTEMPTS
COMPETITOR_RANK_SAMPLE_JITTER_MIN_SEC = AMAZON_SEARCH_RANK_SAMPLE_JITTER_MIN_SEC
COMPETITOR_RANK_SAMPLE_JITTER_MAX_SEC = AMAZON_SEARCH_RANK_SAMPLE_JITTER_MAX_SEC
# 留空则复用下方 PROXY（若配置了本地代理）
COMPETITOR_US_RANK_PROXY = os.getenv("COMPETITOR_US_RANK_PROXY", "").strip()
COMPETITOR_ENABLE_AMAZON_REVIEW_ENRICH = get_bool("COMPETITOR_ENABLE_AMAZON_REVIEW_ENRICH", False)
COMPETITOR_AMAZON_REVIEW_LIMIT = int(os.getenv("COMPETITOR_AMAZON_REVIEW_LIMIT", "20"))
# 自有产品差评同步：全局最多并发 5 个目标，同一站点仍严格串行。
OWN_PRODUCT_CRITICAL_REVIEW_MAX_CONCURRENT = max(
    1, min(int(os.getenv("OWN_PRODUCT_CRITICAL_REVIEW_MAX_CONCURRENT", "1")), 40)
)
OWN_PRODUCT_CRITICAL_REVIEW_PER_MARKET_CONCURRENT = max(
    1, min(int(os.getenv("OWN_PRODUCT_CRITICAL_REVIEW_PER_MARKET_CONCURRENT", "1")), 4)
)
OWN_PRODUCT_CRITICAL_REVIEW_MARKET_CIRCUIT_THRESHOLD = max(
    1, min(int(os.getenv("OWN_PRODUCT_CRITICAL_REVIEW_MARKET_CIRCUIT_THRESHOLD", "3")), 10)
)
# Playwright 打开 amazon.com 易超时（默认 30s）；跨境网络建议 60000–120000
COMPETITOR_AMAZON_REVIEW_NAV_TIMEOUT_MS = int(os.getenv("COMPETITOR_AMAZON_REVIEW_NAV_TIMEOUT_MS", "90000"))
# 直连失败时填写与浏览器一致的代理，例如 http://127.0.0.1:7890（留空则不启用）
COMPETITOR_AMAZON_REVIEW_PROXY = os.getenv("COMPETITOR_AMAZON_REVIEW_PROXY", "").strip()
# 所有站点 Cookie 的唯一目录。生产 Docker 会把共享盘只读挂载到 /app/amazon-cookies。
_DEFAULT_AMAZON_COOKIE_DIR = (
    r"\\192.168.3.222\Office\RPA\Amazon_Cookies"
    if os.name == "nt"
    else "/mnt/office/RPA/Amazon_Cookies"
)
COMPETITOR_AMAZON_COOKIE_DIR = str(
    Path(os.getenv("COMPETITOR_AMAZON_COOKIE_DIR", _DEFAULT_AMAZON_COOKIE_DIR).strip()).expanduser()
)
# 仅用于拿/换 Cookie 的 Playwright 持久化目录（与 test/ 分离，默认 data/playwright_amazon_profile）
_COMPETITOR_AMAZON_PROFILE_DIR_RAW = os.getenv("COMPETITOR_AMAZON_PROFILE_DIR", "").strip()
COMPETITOR_AMAZON_PROFILE_DIR = str(
    Path(_COMPETITOR_AMAZON_PROFILE_DIR_RAW).expanduser()
    if _COMPETITOR_AMAZON_PROFILE_DIR_RAW
    else (BASE_DIR / "data" / "playwright_amazon_profile")
)
# 采集遇到登录墙时是否自动用 profile 续期 Cookie 并重试一次
COMPETITOR_AMAZON_COOKIE_AUTO_REFRESH = get_bool("COMPETITOR_AMAZON_COOKIE_AUTO_REFRESH", True)
# 续期 Cookie 时是否无头；验证码场景请设为 false，手动登录 profile 后再跑
COMPETITOR_AMAZON_COOKIE_REFRESH_HEADLESS = get_bool("COMPETITOR_AMAZON_COOKIE_REFRESH_HEADLESS", True)
# 评论页续期自动登录账号/密码；建议只放 .env 或临时环境变量，不写入代码
COMPETITOR_AMAZON_SIGNIN_EMAIL = os.getenv("COMPETITOR_AMAZON_SIGNIN_EMAIL", "").strip()
COMPETITOR_AMAZON_SIGNIN_PASSWORD = os.getenv("COMPETITOR_AMAZON_SIGNIN_PASSWORD", "").strip()
# 持久化 profile 须用本机 Chrome 打开（data 目录从 Chrome 迁移时必填 chrome）
COMPETITOR_AMAZON_PROFILE_CHANNEL = os.getenv("COMPETITOR_AMAZON_PROFILE_CHANNEL", "chrome").strip()
# 续期/校验 Cookie 默认先按站点搜索“监控摄像头”的本地化关键词，取第一个自然结果 ASIN；
# 下方固定 ASIN 仅作为关键词搜索失败时的兜底。
# 可选按站覆盖：COMPETITOR_AMAZON_COOKIE_PROBE_KEYWORD_US / _DE / _IT / _FR / _ES / _UK / _JP
# 美国站固定兜底默认；欧洲细分站/JP 见 amazon_cookie_store._DEFAULT_COOKIE_PROBE_ASIN_BY_MARKET
COMPETITOR_AMAZON_COOKIE_PROBE_ASIN = (
    os.getenv("COMPETITOR_AMAZON_COOKIE_PROBE_ASIN", "B0CD9ZP7Z2").strip().upper()
)
# 可选按站覆盖固定兜底：COMPETITOR_AMAZON_COOKIE_PROBE_ASIN_US / _DE / _IT / _FR / _ES / _UK / _JP
# 竞品 Amazon 增强字段使用独立的跨时间窗重试。底层请求仍保留快速重试，
# 这里的退避用于跨过代理 TLS EOF / Amazon 短时 reset 窗口。
COMPETITOR_AMAZON_ENRICH_MAX_ATTEMPTS = max(
    1, int(os.getenv("COMPETITOR_AMAZON_ENRICH_MAX_ATTEMPTS", "3"))
)
COMPETITOR_AMAZON_ENRICH_RETRY_BASE_SEC = max(
    0.0, float(os.getenv("COMPETITOR_AMAZON_ENRICH_RETRY_BASE_SEC", "8"))
)
COMPETITOR_AMAZON_ENRICH_RETRY_MAX_SEC = max(
    COMPETITOR_AMAZON_ENRICH_RETRY_BASE_SEC,
    float(os.getenv("COMPETITOR_AMAZON_ENRICH_RETRY_MAX_SEC", "30")),
)
COMPETITOR_COLLECT_MAX_WORKERS = int(os.getenv("COMPETITOR_COLLECT_MAX_WORKERS", "3"))
COMPETITOR_SELLERSPRITE_MAX_WORKERS = max(
    1, int(os.getenv("COMPETITOR_SELLERSPRITE_MAX_WORKERS", "2"))
)
# 同一 ASIN 内关键词排名采集并发数。保持较小值，避免 Amazon 风控放大重试。
COMPETITOR_KEYWORD_MAX_WORKERS = max(
    1, int(os.getenv("COMPETITOR_KEYWORD_MAX_WORKERS", "2"))
)
COMPETITOR_SIF_SYNC_MAX_WORKERS = max(
    1, int(os.getenv("COMPETITOR_SIF_SYNC_MAX_WORKERS", "2"))
)
# 竞品监控「数据采集」成功后是否顺带拉取 SIF 反查关键词并写入 PG（需配置 SIF 凭证与 DATABASE_URL）
COMPETITOR_ENABLE_SIF_KEYWORDS_SYNC = get_bool("COMPETITOR_ENABLE_SIF_KEYWORDS_SYNC", True)
# 竞品监控默认定时采集（系统内置 schedule，不可删除；需 TASK_SCHEDULER_ENABLED=true）
COMPETITOR_DAILY_COLLECT_CRON = os.getenv("COMPETITOR_DAILY_COLLECT_CRON", "0 6 * * *").strip()
COMPETITOR_DAILY_COLLECT_ENABLED = get_bool("COMPETITOR_DAILY_COLLECT_ENABLED", True)

# 旧共享盘源库镜像链路已退役；保留配置键仅用于确保历史环境默认关闭。
AMZ_PD_REG_SYNC_CRON = os.getenv("AMZ_PD_REG_SYNC_CRON", "30 9 * * *").strip()
AMZ_PD_REG_SYNC_ENABLED = get_bool("AMZ_PD_REG_SYNC_ENABLED", False)

# 运营洞察由每日登记 ETL 成功后立即刷新；10:00 定时任务仅作漏跑兜底。
OPS_INSIGHTS_DAILY_CRON = os.getenv("OPS_INSIGHTS_DAILY_CRON", "0 10 * * *").strip()
OPS_INSIGHTS_DAILY_ENABLED = get_bool("OPS_INSIGHTS_DAILY_ENABLED", True)

OWN_PRODUCT_CRITICAL_REVIEW_SYNC_CRON = os.getenv(
    "OWN_PRODUCT_CRITICAL_REVIEW_SYNC_CRON", "*/30 * * * *"
).strip()
OWN_PRODUCT_CRITICAL_REVIEW_SYNC_ENABLED = get_bool(
    "OWN_PRODUCT_CRITICAL_REVIEW_SYNC_ENABLED", True
)
# 同步新增差评后自动单条 AI 深度分析（可在 .env 关闭）
OWN_PRODUCT_CRITICAL_REVIEW_AUTO_AI = get_bool(
    "OWN_PRODUCT_CRITICAL_REVIEW_AUTO_AI", True
)

# 任务队列（PostgreSQL 持久化，无需 Redis）
TASK_WORKER_ENABLED = get_bool("TASK_WORKER_ENABLED", False)
TASK_SCHEDULER_ENABLED = get_bool("TASK_SCHEDULER_ENABLED", False)
TASK_WORKER_POLL_INTERVAL = float(os.getenv("TASK_WORKER_POLL_INTERVAL", "15"))
TASK_DEFAULT_MAX_RETRIES = max(0, int(os.getenv("TASK_DEFAULT_MAX_RETRIES", "3")))
# 任务默认走独立执行路线。只有显式列入此清单的类型才共享最多 3 个受限槽位。
TASK_WORKER_BOUNDED_TASK_TYPES = tuple(
    item.strip()
    for item in os.getenv("TASK_WORKER_BOUNDED_TASK_TYPES", "").split(",")
    if item.strip()
)
TASK_WORKER_BOUNDED_MAX_CONCURRENT = min(
    3,
    max(1, int(os.getenv("TASK_WORKER_BOUNDED_MAX_CONCURRENT", "3"))),
)
# running 任务超过此秒数未更新 updated_at（进度心跳）则视为 Worker 已失联，自动重新入队
TASK_WORKER_LEASE_SECONDS = max(60, int(os.getenv("TASK_WORKER_LEASE_SECONDS", "300")))
# Worker 执行中自动续租心跳间隔；默认约为 lease 的 1/3，避免长 IO 阶段被误回收
TASK_WORKER_HEARTBEAT_INTERVAL = max(
    5,
    int(os.getenv("TASK_WORKER_HEARTBEAT_INTERVAL", str(max(10, TASK_WORKER_LEASE_SECONDS // 3)))),
)
# 独立 watchdog 扫描过期租约的间隔；不参与任务执行，避免被长任务阻塞
TASK_WORKER_WATCHDOG_INTERVAL = max(5, int(os.getenv("TASK_WORKER_WATCHDOG_INTERVAL", "30")))
# Worker 进程启动时：超过此秒数仍 running 的任务视为上一轮进程遗留，立即重新入队（开发热重载场景）
TASK_WORKER_STARTUP_RECLAIM_SECONDS = max(15, int(os.getenv("TASK_WORKER_STARTUP_RECLAIM_SECONDS", "45")))

# 竞品调研长任务：保留完整候选数据，但用受控并发缩短网络 IO 等待时间
COMPETITOR_RESEARCH_DETAIL_MAX_WORKERS = max(
    1, int(os.getenv("COMPETITOR_RESEARCH_DETAIL_MAX_WORKERS", "4"))
)
COMPETITOR_RESEARCH_DETAIL_RETRIES = max(
    1, int(os.getenv("COMPETITOR_RESEARCH_DETAIL_RETRIES", "8"))
)
COMPETITOR_RESEARCH_DETAIL_RETRY_BASE_SEC = max(
    0.0, float(os.getenv("COMPETITOR_RESEARCH_DETAIL_RETRY_BASE_SEC", "2.0"))
)
COMPETITOR_RESEARCH_DETAIL_RETRY_MAX_SEC = max(
    0.0, float(os.getenv("COMPETITOR_RESEARCH_DETAIL_RETRY_MAX_SEC", "30.0"))
)
COMPETITOR_RESEARCH_RATE_LIMIT_COOLDOWN_SEC = max(
    0.0, float(os.getenv("COMPETITOR_RESEARCH_RATE_LIMIT_COOLDOWN_SEC", "45.0"))
)
COMPETITOR_RESEARCH_IMAGE_MAX_WORKERS = max(
    1, int(os.getenv("COMPETITOR_RESEARCH_IMAGE_MAX_WORKERS", "8"))
)
COMPETITOR_RESEARCH_FEATURE_MATCH_BATCH_SIZE = max(
    1, int(os.getenv("COMPETITOR_RESEARCH_FEATURE_MATCH_BATCH_SIZE", "8"))
)
COMPETITOR_RESEARCH_FEATURE_MATCH_MAX_WORKERS = max(
    1, int(os.getenv("COMPETITOR_RESEARCH_FEATURE_MATCH_MAX_WORKERS", "2"))
)
COMPETITOR_RESEARCH_FEATURE_MATCH_TIMEOUT_SEC = max(
    30.0, float(os.getenv("COMPETITOR_RESEARCH_FEATURE_MATCH_TIMEOUT_SEC", "600"))
)
COMPETITOR_RESEARCH_LLM_TIMEOUT_SEC = max(
    30.0, float(os.getenv("COMPETITOR_RESEARCH_LLM_TIMEOUT_SEC", str(COMPETITOR_RESEARCH_FEATURE_MATCH_TIMEOUT_SEC)))
)
COMPETITOR_RESEARCH_LLM_MAX_RETRIES = max(
    1, int(os.getenv("COMPETITOR_RESEARCH_LLM_MAX_RETRIES", "10"))
)

# 企业知识库 / RAG 服务（由 Flask 统一代理，前端不直接调用）
RAG_SERVICE_BASE_URL = os.getenv(
    "RAG_SERVICE_BASE_URL",
    "http://127.0.0.1:8011/api/v1",
).strip().rstrip("/")
RAG_SERVICE_TIMEOUT_SEC = float(os.getenv("RAG_SERVICE_TIMEOUT_SEC", "60"))


def validate_environment_isolation() -> None:
    """Fail closed when a development process points at production resources."""

    if CBOPS_ENVIRONMENT != "development":
        return

    allowed_hosts = {"business-postgres", "localhost", "127.0.0.1", "::1"}
    required_databases = (
        ("DATABASE_URL", DATABASE_URL, "business_operations_dev"),
        (
            "AMAZON_DAILY_REGISTRATION_URL",
            AMAZON_DAILY_REGISTRATION_URL,
            "amazon_daily_registration_dev",
        ),
    )
    failures: list[str] = []
    for name, raw_url, expected_database in required_databases:
        parsed = urlparse(str(raw_url or ""))
        if parsed.hostname not in allowed_hosts:
            failures.append(f"{name} host must be an isolated development host")
        if parsed.path.lstrip("/") != expected_database:
            failures.append(f"{name} database must be {expected_database}")

    if TASK_SCHEDULER_ENABLED:
        failures.append("TASK_SCHEDULER_ENABLED must be false in development")
    if REMOTE_EXECUTION_ENABLED:
        failures.append("REMOTE_EXECUTION_ENABLED must be false in development")
    if WORKFLOW_CENTER_ENABLED:
        failures.append("WORKFLOW_CENTER_ENABLED must be false in development")

    if failures:
        raise RuntimeError("Development environment isolation failed: " + "; ".join(failures))


validate_environment_isolation()
