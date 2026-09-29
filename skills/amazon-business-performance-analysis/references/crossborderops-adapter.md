# CrossBorderOps 后台数据适配

本项目的 CrossBorderOps 后台位于 jennov-75，已有 `/api/daily-analysis` 报表接口。实时调用必须先用当前钉钉消息中的 `corpId + userId` 查询后台计算出的有效店铺范围，再调用只读报表接口；不得使用 `superadmin` 或区域负责人账号代查。未绑定、停用、工厂部门人员和有效范围为空时，按无权限处理。没有授权连接器时，只分析当前用户主动提供的后台导出数据。

授权模型不是按国家或 TAG 推算：一个钉钉用户可以关联现有 CrossBorderOps 账号并继承该账号的全部已授权店铺，也可以直接指定店铺；同一用户可以配置多条映射，最终权限是所有映射店铺的并集。同一店铺可以授权给多个钉钉用户。后台管理员页面从钉钉应用通讯录同步人员候选，排除工厂部门及其下级；最终权限以店铺 SID 为准。

## 已核对的数据字段

`/daily-analysis/products` 与 `/daily-analysis/product/<asin>` 由 `daily_analysis_serialize.py` 输出日级产品行；`/summary`、`/trend`、`/top-products` 和 `/availability` 提供汇总、趋势、排序和可用日期。主要字段：

| 领域 | 字段 | 分析用途 |
|---|---|---|
| 标识 | `analysis_date`, `lingxing_sid`, `store_name`, `store_country`, `asin`, `sku`, `product_id`, `operator` | 固定店铺、站点、产品、日期，避免串店与父子体重复 |
| 销售 | `daily_sales`, `daily_revenue`, `order_count`, `average_order_value`, `price` | 销售变化、ASIN 贡献、订单结构与均价变化 |
| 流量与承接 | `sessions`, `page_views`, `session_pct`, `page_views_pct`, `unit_session_pct`, `buy_box_pct` | 流量、转化、购物车占比及结构变化；百分比字段以小数返回 |
| 广告 | `ad_clicks`, `non_ad_clicks`, `ad_spend`, `ad_orders`, `ad_sales`, `cpc`, `acos`, `cvr`, `ad_spend_ratio`, `ad_scope` | 投放变化、广告效率、广告与总销售联动 |
| 商品健康 | `inventory_count`, `rating_score`, `review_count`, `main_category_rank`, `sub_category_rank` | 库存、评分评论及 BSR 变化与销售走势对照 |
| 数据质量 | `business_complete`, `ads_complete`, `business_missing_fields`, `ad_missing_fields`, `ad_zero_provisional`, `ad_recovery_eligible`, `ad_reason_code`, `business_source`, `ad_source`, `metric_etl_at`, `snapshot_source` | 判断数值是否完整、来源是什么、零值是否只是占位 |

## 使用纪律

1. 先以当前 `corpId + userId` 调用有效范围接口，再调用可用日期与报表接口；按最小时间窗、最小 ASIN 集合取数。权限由后台服务端按用户限定，不接受模型传入“代查账号”。
2. 后台序列化为了展示，会把部分原始空值转成 `0`。当 `business_complete=false`、`ads_complete=false` 或存在缺失字段/临时零值时，不能把 `0` 写成真实零销量、零花费或零点击。
3. 百分比字段为小数，例如 `0.2653` 表示 26.53%；展示时再乘 100。`daily_sales` 的业务定义要以当前报表说明为准，不与 `order_count` 混同。
4. 日本站广告存在不同运营账号视图：`ops_jp` 为 SP+SB+SBV+SD 全广告口径，`ops_jp1` 为 SP/SD 明细口径。跨视图比较或聚合前必须标明 `ad_scope`，不能把后者替代全广告数据。
5. 评分/评论与 BSR 可用来提出待验证假设；不能仅因两者同日变化就断言是销售变动的原因。BSR 数值越小通常排名越靠前，但不同类目不可横比。
6. 该宽表没有完整采购成本、FBA 费用与退款明细时，不能从 `daily_revenue−ad_spend` 宣称净利润。需要利润结论时补充领星或财务报表。

当前钉钉 Agent 只通过 `crossborderops.query` 实时读取公司自有店铺数据。共享密钥领星 `action` 已暂停暴露，因为它不能证明逐店铺裁剪；用户主动提供的领星报表仍可作为分析输入。

通用指标查询使用 `daily.metrics`：按问题选择 `dimensions`（`store`、`site`、`asin`、`sku`、`date` 的组合）与 `measures`（销量、销售额、订单、Sessions、广告与派生比率、价格/评分/排名/库存等 Listing 状态），需要变化时加 `compare`。它只统计业务行（排除 snapshot 快照行），每行给出 `coverage`：`business_rows` 少于 `expected_rows` 或存在 `incomplete_rows` 时，如实说明该对象数据不完整，而不是把缺失当零或整行丢弃。`totals_by_site` 是按站点本币的全部分组合计。`daily.aggregate` 为兼容保留，只支持销量与销售额且会排除不完整分组，新查询不再使用它。以下为其旧说明：单一时段的筛选、聚合和排序使用 `daily.aggregate`。按用户问题选择 `dimensions`（`store`、`site`、`asin` 的组合）、`measures`（`units`、`revenue`）、`order_by` 与 `order`，并传入实际所需的 `start_date`、`end_date`；结果包含分页、并列数量和完整性覆盖。跨站点销售额不能直接混合排序；未出现在数据源中的实体无法参与排名。是否按 ASIN 跨店铺聚合取决于用户所问粒度，不能把“店铺 × 站点 × ASIN”行数说成独立 ASIN 数量。单期问题不引入基线。

开放式销量下滑发现使用 `daily.performance_changes`：后端按当前用户授权 SID 对店铺 × 站点 × ASIN 做两期等长聚合，默认最近完整 7 日对比前 7 日，返回销量与销售额差额、日期和完整性约束。仅完整且有非零基线的数据进入下滑榜；未进入榜单不等于“销量正常”，需要检查缺失数据和新品。`daily.top_products` 是畅销榜，不能替代下滑榜；`daily.products` 已限制时间窗和分页，不用于全量扫描。SIF 公开信号仅用于补充市场解释，不能替代内部销售数据或单独证明原因。

## 来源优先级

同一问题中，优先使用已授权、口径清晰且完整的后台日级宽表做经营趋势和 ASIN 定位；用户主动提供的领星报表可补后台缺少的库存状态、在途、费用或利润等字段。若两方数值冲突，列出两个来源及差异，按可追溯的定义和完整性选择分析口径，不能暗中覆盖。
