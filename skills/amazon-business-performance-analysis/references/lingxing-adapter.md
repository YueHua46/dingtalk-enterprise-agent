# 领星数据适配

CrossBorderOps 是首选经营数据源；需要补充真实领星数据时，用 capability.search 发现 lingxing.scoped.*，再通过 lingxing.catalog search 查询该 toolId 的官方参数，使用 lingxing.read_scoped 执行业务查询。共享 lingxing.action 保持禁用。

宿主每次按当前 corpId + userId 刷新授权范围，校验 params.store_sids 子集并注入官方店铺参数；广告报表另做 SID / Profile ID 映射。返回值保留 scope、evidence、原始 data 和 coverage；查询时间不等于数据更新时间。单店接口必须选单店。未知参数和越权请求直接报错，不能通过其他身份补查。

已登记领域覆盖 Listing、FBA 库存、销售统计、产品表现、利润、交易、赔偿、退货、客户、绩效、买家之声、促销及预警。详细工具映射和广告参数见 [领星只读路由](../../amazon-advertising-ai-optimizer/references/lingxing-mcp-routing.md)。补货建议 query_fba_valid_list 因上游返回跨店铺聚合已禁用；财务对账列表 finance_list_trade_reconcile 实测上游内部错误，不能宣称已取得该数据。

逐项核对来源的日期口径、归因窗口、币种、时区、父子 ASIN 与更新时间。保留分页和汇总行，按官方页码/偏移继续取数；未验证全量时不称为完整数据，避免把汇总行和明细重复相加。空数组、上游报错、映射缺失与未覆盖店铺不等于零。用户提供的报表也按相同口径核对。

按需优先顺序：

- “整体怎么样”：销售/订单及 ASIN 分布，随后仅补最可能影响结论的流量、库存或利润。
- “为什么销售下降”：两期销售与 ASIN 贡献，随后针对贡献最大的 ASIN 补流量/CVR、可售库存、Listing、广告与促销事件。
- “会不会断货”：当前可售库存、过去一段时间销量、已确认的在途数量和到货时间。
- “赚不赚钱”：销售、退款、平台费、广告、采购及物流成本；缺项列明覆盖范围。

领星报告不是 Amazon 的 Data Kiosk 指标。Amazon 官方 Skill 中的 `FBA_INV_VIS_*`、`SESSION_CNT` 等 ID 只说明分析意图，不可当作领星字段或请求参数。
