from . import (
    AdOptimizationReports,
    AdReconciliation,
    CompCriticalReviews,
    CompetitorMonitoringRecord,
    CompetitorKeywordMonitor,
    CompetitorReviewObservation,
    CompetitorPageEvidence,
    CompetitorRankDropEvidence,
    CompetitorProduct,
    CompetitorTag,
    CompetitorResearchRun,
    CommerceIntelArchive,
    DailyProductAnalysis,
    DailyLineage,
    KeywordTagLibrary,
    OpsInsightDailyCache,
    PricingRecord,
    ReviewNotifyAsins,
    SifAsinKeywords,
    SifKeywordSyncState,
    StoreAccess,
    TagDefinition,
    WordRootGraph,
    WorkbookWriteback,
    AmazonRankTracker,
    db_initializer,
    ProxyPoolSettings,
    CompetitorVocReport,
    AmazonShipmentSettings,
)


class Database:
    _schema_bootstrapped = False

    def __init__(self):
        self.pricing_record = PricingRecord()
        self.competitor_product = CompetitorProduct()
        self.competitor_tags = CompetitorTag()
        self.competitor_research = CompetitorResearchRun()
        self.commerce_intel_archive = CommerceIntelArchive()
        self.monitoring_record = CompetitorMonitoringRecord()
        self.competitor_keyword_monitor = CompetitorKeywordMonitor()
        self.competitor_review_observation = CompetitorReviewObservation()
        self.competitor_page_evidence = CompetitorPageEvidence()
        self.competitor_rank_drop_evidence = CompetitorRankDropEvidence()
        self.ad_reports = AdOptimizationReports()
        self.ad_reconciliation = AdReconciliation()
        self.comp_critical_reviews = CompCriticalReviews()
        self.review_notify_asins = ReviewNotifyAsins()
        self.sif_keywords = SifAsinKeywords()
        self.sif_keyword_sync_state = SifKeywordSyncState()
        self.keyword_tags = KeywordTagLibrary()
        self.tag_definitions = TagDefinition()
        self.word_root_graph = WordRootGraph()
        self.daily_product_analysis = DailyProductAnalysis()
        self.daily_lineage = DailyLineage()
        self.ops_insight_daily_cache = OpsInsightDailyCache()
        self.store_access = StoreAccess()
        self.workbook_writeback = WorkbookWriteback()
        self.amazon_rank_tracker = AmazonRankTracker()
        self.proxy_pool_settings = ProxyPoolSettings()
        self.competitor_voc_report = CompetitorVocReport()
        self.amazon_shipment_settings = AmazonShipmentSettings()
        self.competitor_monitoring_record = self.monitoring_record
        self._bootstrap_schema_once()

    @property
    def ad_framework_keywords(self) -> SifAsinKeywords:
        """已废弃别名：与 ``sif_keywords`` 相同，框架 API 请优先使用 ``sif_keywords``。"""
        return self.sif_keywords

    @property
    def is_available(self):
        return self.pricing_record.is_configured

    def ping(self) -> bool:
        if not self.is_available:
            return False
        with self.pricing_record._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone() is not None
    
    def init_db(self):
        """
        初始化数据库，创建必要的表
        """
        return db_initializer.init_all()

    def _bootstrap_schema_once(self):
        """在应用初始化阶段完成一次数据库表结构准备。"""
        if Database._schema_bootstrapped:
            return
        if not self.is_available:
            return
        try:
            self.init_db()
            # 监控表包含额外 ENSURE_SCHEMA 逻辑，初始化时也一起执行
            self.competitor_monitoring_record._ensure_schema()
            Database._schema_bootstrapped = True
        except Exception as e:
            print(f"数据库初始化失败: {e}")
    
    # --- 定价记录 ---
    
    def save_pricing_record(self, data, result, *, sop_file_name: str | None = None, owner_user_id: int | None = None):
        if not self.is_available:
            return None
        return self.pricing_record.save(data, result, sop_file_name=sop_file_name, owner_user_id=owner_user_id)

    def get_pricing_record_by_sop_file(self, sop_file_name: str, *, owner_user_id: int | None = None):
        if not self.is_available:
            return None
        return self.pricing_record.get_by_sop_file(sop_file_name, owner_user_id=owner_user_id)
    
    def get_pricing_records(self, limit=100, *, owner_user_id: int | None = None):
        if not self.is_available:
            return []
        return self.pricing_record.get_all(limit, owner_user_id=owner_user_id)
    
    def get_pricing_record_by_id(self, record_id, *, owner_user_id: int | None = None):
        if not self.is_available:
            return None
        return self.pricing_record.get_by_id(record_id, owner_user_id=owner_user_id)
    
    # --- 竞品产品 ---
    
    def add_competitor(self, **kwargs):
        if not self.is_available:
            return None
        return self.competitor_product.add_product(**kwargs)
    
    def get_competitors(self, active_only=True):
        if not self.is_available:
            return []
        return self.competitor_product.get_all_products(active_only)
    
    def get_competitor_by_asin(self, asin):
        if not self.is_available:
            return None
        return self.competitor_product.get_by_asin(asin)
    
    def delete_competitor(self, product_id):
        if not self.is_available:
            return False
        return self.competitor_product.delete_product(product_id)
    
    # --- 监控记录 ---
    
    def save_monitoring_record(self, product_id, record_date, **kwargs):
        if not self.is_available:
            return None
        return self.monitoring_record.save_record(product_id, record_date, **kwargs)
    
    def get_monitoring_records(self, product_id=None, start_date=None, end_date=None, limit=100):
        if not self.is_available:
            return []
        return self.monitoring_record.get_records(product_id, start_date, end_date, limit)
    
    def get_monitoring_grouped(self, product_ids, days=30):
        if not self.is_available:
            return [], []
        return self.monitoring_record.get_records_grouped_by_date(product_ids, days)
