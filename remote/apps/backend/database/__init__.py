from .models.sif_keywords import SifAsinKeywords
from .models.sif_keyword_sync_state import SifKeywordSyncState
from .models.ad_optimization_reports import AdOptimizationReports
from .models.ad_reconciliation import AdReconciliation
from .models.comp_critical_reviews import CompCriticalReviews
from .models.review_notify_asins import ReviewNotifyAsins
from .models.base import BaseModel, DatabaseInitializer
from .models.pricing_records import PricingRecord
from .models.competitor_monitoring_record import CompetitorMonitoringRecord
from .models.competitor_review_observation import CompetitorReviewObservation
from .models.competitor_page_evidence import CompetitorPageEvidence
from .models.competitor_rank_drop_evidence import CompetitorRankDropEvidence
from .models.competitor_product import CompetitorProduct
from .models.competitor_tag import CompetitorTag
from .models.competitor_keyword_monitor import CompetitorKeywordMonitor
from .models.competitor_research import CompetitorResearchRun
from .models.keyword_tag_library import KeywordTagLibrary
from .models.tag_definition import TagDefinition
from .models.word_root_graph import WordRootGraph
from .models.daily_product_analysis import DailyProductAnalysis
from .models.amz_pd_reg import AmzPdReg
from .models.task_queue import TaskQueueModel, TaskScheduleModel
from .models.llm_settings import LlmSettings
from .models.dingtalk_settings import DingTalkSettings
from .models.dingtalk_registered_groups import DingTalkRegisteredGroups
from .models.ad_diagnosis_config import AdDiagnosisConfig
from .models.app_user import AppUser
from .models.commerce_intel_archive import CommerceIntelArchive
from .models.ops_insight_cache import OpsInsightDailyCache
from .models.external_integration_settings import ExternalIntegrationSettings
from .models.remote_execution import RemoteExecutionModel
from .models.workflow import WorkflowModel
from .models.store_access import StoreAccess
from .models.daily_lineage import DailyLineage
from .models.amazon_product_snapshot import AmazonProductSnapshot
from .models.workbook_writeback import WorkbookWriteback
from .models.lingxing_report_export import LingXingReportExport
from .models.active_listing_catalog import ActiveListingCatalog
from .models.amazon_rank_tracker import AmazonRankTracker
from .models.operations_recovery import OperationsRecovery
from .models.product_writeback_mapping import ProductWritebackMapping
from .models.workbook_import_audit import WorkbookImportAudit
from .models.operations_repair_checklist import OperationsRepairChecklist
from .models.proxy_pool_settings import ProxyPoolSettings
from .models.competitor_voc_report import CompetitorVocReport
from .models.amazon_shipment_settings import AmazonShipmentSettings
from .models.amazon_shipment_pending import AmazonShipmentPending
from .models.dingtalk_directory import DingTalkDirectory, AgentDataGrant

db_initializer = DatabaseInitializer()

db_initializer.register_model(PricingRecord)
db_initializer.register_model(CompetitorProduct)
db_initializer.register_model(CompetitorResearchRun)
db_initializer.register_model(CompetitorMonitoringRecord)
db_initializer.register_model(CompetitorKeywordMonitor)
db_initializer.register_model(CompetitorReviewObservation)
db_initializer.register_model(CompetitorPageEvidence)
db_initializer.register_model(CompetitorRankDropEvidence)
db_initializer.register_model(AdOptimizationReports)
db_initializer.register_model(AdReconciliation)
db_initializer.register_model(CompCriticalReviews)
db_initializer.register_model(KeywordTagLibrary)
db_initializer.register_model(SifAsinKeywords)
db_initializer.register_model(SifKeywordSyncState)
db_initializer.register_model(TagDefinition)
db_initializer.register_model(WordRootGraph)
db_initializer.register_model(AppUser)
db_initializer.register_model(CompetitorTag)
db_initializer.register_model(StoreAccess)
db_initializer.register_model(ActiveListingCatalog)
db_initializer.register_model(AmzPdReg)
db_initializer.register_model(DailyProductAnalysis)
db_initializer.register_model(ReviewNotifyAsins)
db_initializer.register_model(TaskQueueModel)
db_initializer.register_model(TaskScheduleModel)
db_initializer.register_model(AmazonProductSnapshot)
db_initializer.register_model(LlmSettings)
db_initializer.register_model(DingTalkSettings)
db_initializer.register_model(DingTalkRegisteredGroups)
db_initializer.register_model(AdDiagnosisConfig)
db_initializer.register_model(DailyLineage)
db_initializer.register_model(OpsInsightDailyCache)
db_initializer.register_model(CommerceIntelArchive)
db_initializer.register_model(ExternalIntegrationSettings)
db_initializer.register_model(RemoteExecutionModel)
db_initializer.register_model(WorkflowModel)
db_initializer.register_model(WorkbookWriteback)
db_initializer.register_model(LingXingReportExport)
db_initializer.register_model(AmazonRankTracker)
db_initializer.register_model(OperationsRecovery)
db_initializer.register_model(ProductWritebackMapping)
db_initializer.register_model(WorkbookImportAudit)
db_initializer.register_model(OperationsRepairChecklist)
db_initializer.register_model(ProxyPoolSettings)
db_initializer.register_model(CompetitorVocReport)
db_initializer.register_model(AmazonShipmentSettings)
db_initializer.register_model(AmazonShipmentPending)
db_initializer.register_model(DingTalkDirectory)
db_initializer.register_model(AgentDataGrant)

__all__ = [
    'BaseModel',
    'DatabaseInitializer',
    'PricingRecord',
    'CompetitorProduct',
    'CompetitorTag',
    'CompetitorKeywordMonitor',
    'CompetitorResearchRun',
    'CompetitorMonitoringRecord',
    'CompetitorReviewObservation',
    'CompetitorPageEvidence',
    'CompetitorRankDropEvidence',
    'AdOptimizationReports',
    'AdReconciliation',
    'CompCriticalReviews',
    'ReviewNotifyAsins',
    'SifAsinKeywords',
    'SifKeywordSyncState',
    'KeywordTagLibrary',
    'TagDefinition',
    'WordRootGraph',
    'DailyProductAnalysis',
    'AmzPdReg',
    'TaskQueueModel',
    'TaskScheduleModel',
    'AmazonProductSnapshot',
    'LlmSettings',
    'DingTalkSettings',
    'AdDiagnosisConfig',
    'AppUser',
    'StoreAccess',
    'DailyLineage',
    'OpsInsightDailyCache',
    'CommerceIntelArchive',
    'ExternalIntegrationSettings',
    'RemoteExecutionModel',
    'WorkflowModel',
    'WorkbookWriteback',
    'LingXingReportExport',
    'ActiveListingCatalog',
    'AmazonRankTracker',
    'OperationsRecovery',
    'ProductWritebackMapping',
    'WorkbookImportAudit',
    'OperationsRepairChecklist',
    'ProxyPoolSettings',
    'CompetitorVocReport',
    'AmazonShipmentSettings',
    'AmazonShipmentPending',
    'DingTalkDirectory',
    'AgentDataGrant',
    'db_initializer',
]
