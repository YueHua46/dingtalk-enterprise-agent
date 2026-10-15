# 领星 MCP 按店铺只读路由

所有业务调用使用 `lingxing.read_scoped`。宿主每次以当前 `corpId + userId` 向 CrossBorderOps 刷新有效授权，把店铺 SID 写入官方请求；广告报表通过真实 `ad_auth_shops` 映射到 Profile ID。这里查询的是真实领星 MCP，不是 CrossBorderOps `ads.metrics` 的别名。共享 `lingxing.action` 不可用。

## 广告分析选用接口

| toolId | 用途 |
| --- | --- |
| `ad_auth_shops` | 当前授权店铺的广告 SID / Profile ID 映射 |
| `ad_campaign_report` | 广告活动表现、预算与竞价策略 |
| `ad_campaign_group_report` | 广告组表现 |
| `ad_campaign_keyword_report` | 配置关键词、匹配方式及关键词表现 |
| `ad_campaign_search_term_report` | 客户实际搜索词及表现 |
| `ad_campaign_product_report` | 广告商品、ASIN / MSKU 表现 |
| `ad_campaign_targeting_report` | 商品投放目标及表现 |
| `ad_portfolio_report_shop` | 广告组合表现 |
| `advertising_ad_analyze_keyword` | 按 ASIN / MSKU 反查并分析关键词 |
| `advertising_order_analysis_list` | 指定 MSKU 的广告出单时段，按小时或按周 |

先用 `lingxing.catalog` 查询官方参数：`{"toolId":"search","params":{"toolId":"ad_campaign_report"}}`。业务调用示例：

```json
{"toolId":"ad_campaign_report","params":{"store_sids":[240],"report_date":"2026-10-08 - 2026-10-14","sort_field":"spends","page":1,"length":20}}
```

`store_sids` 是宿主提供的授权店铺子集筛选。示例 SID 和日期仅用于说明，应替换为本次任务的授权店铺与时间。其余参数严格按该接口官方 Schema；不同接口的 `length` 可能为字符串，`campaign_id` 可能为字符串或数组，不要沿用其他接口的类型。默认值由宿主补齐；未知参数报错，不会静默忽略。Profile ID 由宿主校验，不能用它跨越授权范围。单店接口必须明确选择一个 SID。

关键词分析还必须提供非空 `asin` 或 `msku` 数组，并传 `start_date` / `end_date`（最长 31 天）；ASIN、MSKU 从当前授权店铺的 Listing 或商品广告证据取得。出单时段使用 `sku` 数组和 `group_type: hourly|weekly`。

## 经营数据补充

用 `capability.search` 按中文业务目标发现 `lingxing.scoped.*`，再用目录查看官方参数。已登记的领域包括：

| 领域 | 主要 toolId |
| --- | --- |
| 店铺与 Listing | `get_my_sids`、`erp_listing`、`sales_operate_log_list` |
| 库存与产品表现 | `get_fba_stock_list`、`query_product_performance_asin_lists`、`analytics_trend_hour_info`、`analytics_log_list_v2` |
| 退货、客户、绩效、买家之声 | `customer_service_rma_list`、`customer_service_customer_index`、`customer_performance_notice_list`、`customer_store_target_detail`、`customer_store_performance_list`、`customer_voice_buyer_list` |
| 财务与赔偿 | `finance_order_transcation_list`、`finance_page_list_msku`、`finance_settlement_profit_list`、`finance_compare_trade_reconcile`、`finance_list_trade_reconcile`、`analytics_report_reimbursement_list`、`analytics_report_adjustment_list` |
| 促销、预警、销量 | `sales_detail_prime_discount`、`sales_detail_sec_kill`、`sales_promotional_listing_detail`、`sales_adjust_price_manual`（只读调价队列）、`settings_message_seller_list`、`platform_v2_page_list` |

`query_fba_valid_list` 补货建议实测返回跨店铺聚合，已禁用。目录可发现的其他工具不代表已具备用户店铺隔离；未登记工具不能通过共享 action 执行。

## 证据与完整性

保留返回的 `scope`、`evidence.applied_params`、`applied_profile_ids`、`queried_at` 和 `coverage`。`queried_at` 是查询时间，不是业务数据更新时间。原始数据和分页总数保留在 `data` 中，可能还有嵌套 `data`、`recordsFiltered`、`total`、`records` 等；按对应接口的页码或偏移量继续读取，禁止把第一页称为全量。广告汇总行可能与明细同时存在，不要重复求和。

客户搜索词报表中的 `query` 是客户实际输入；`target_text` 是卖家配置关键词或投放目标，两者不能互换。不同来源的归因窗口、币种、时区、订单与销售口径必须核对后才能比较；不跨币种直接相加。空数组仅说明该查询未取得记录；上游报错、缺少广告映射、分页未完成和店铺未覆盖都保留为缺口，不能写成零。宿主发现返回含其他店铺时整次拒绝；不要自行重试无范围查询。
