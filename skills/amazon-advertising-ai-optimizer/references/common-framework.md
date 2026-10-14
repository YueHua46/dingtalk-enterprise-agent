# 通用广告分析框架

## 输入确认

至少确认：站点和币种、店铺、ASIN/SKU、广告类型、广告阶段、业务目标、分析周期、目标 ACoS/保本 ACoS、产品价格和可用数据源。没有提供的字段写“未知”。

广告阶段使用 `launch`（新品）、`growth`（增长）、`stable`（稳定）、`scale`（爆款/放量）或 `clearance`（清货）。不得用站点规则替代用户明确的阶段。

## 数据顺序

1. 获取当前用户有效店铺范围。
2. 查询数据可用日期和归因口径。
3. 以最小时间窗和对象集合查询汇总数据。
4. 需要下钻时查询搜索词、投放目标和广告位明细。
5. 保存原始结果和计算证据，保留来源、查询时间和数据截至日。

## 指标定义

```text
CTR  = clicks / impressions
CPC  = spend / clicks
CVR  = orders / clicks
CPA  = spend / orders
ACoS = ad_spend / ad_sales
ROAS = ad_sales / ad_spend
TACoS = ad_spend / total_sales
```

百分比以小数存储、展示时转为百分比。分母为 0 或字段缺失时为“未知”。不得用 `revenue - ad_spend` 代替净利润。

## 诊断顺序

1. 数据完整性和归因一致性。
2. 曝光和点击：流量是否足够、CTR 是否异常。
3. 转化和加购：页面承接、价格、评价、延迟转化。
4. 成本和利润：CPC、CPA、ACoS、预算消耗和毛利约束。
5. 搜索词、投放目标、广告位和活动结构。
6. 库存、Buy Box、Listing、促销和历史调整作为替代解释。

每个原因写明证据和验证方法。同期变化只能写成推断，不写成已证实因果。

