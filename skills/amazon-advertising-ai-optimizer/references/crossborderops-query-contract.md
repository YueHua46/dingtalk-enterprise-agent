# CrossBorderOps 广告分析查询契约

本文件约束广告分析使用真实可验证的数据集和参数。权限仍由宿主根据当前 `corpId + userId` 计算，模型不能自行传入 SID、corpId 或 userId。

## 推荐顺序

1. `daily.availability`：确认数据最新日期与授权站点。未明确包含今天时，最近 N 天以最近完整日为结束日，不能把当天快照的最新日期当作完整业务日；ads.metrics 默认窗口已按此处理。明确本次 start_date/end_date，后续查询沿用相同窗口和 site/store_sids。用户显式指定日期则保持原意。
2. `ads.metrics`：对窗口内全部已入库记录先聚合，再对分组结果排序/分页。整体与分层诊断优先使用它。返回的指标已经由服务端计算，直接引用；需要跨分组派生时再用 analysis.python。
   - `sources:["sp_search_terms","sb_search_terms"]`，`dimensions:["store","campaign"]`：活动指标与完整 `totals_by_store_report`，据用户目标下钻 `ad_group`、`target` 或 `search_term`。
   - `sources:["placements"]`，`dimensions:["store","placement"]`：整个窗口的广告位指标；需要活动级定位时加 `campaign`。
   - `sources:["sp_products"]`，`dimensions:["store","asin"]`：直接广告商品关联的 SP ASIN 指标。没有该类型记录时如实说明；不得把搜索词归属猜成商品归属。
   - `campaign_ids`、`ad_group_ids`、`asins` 只在对应来源支持时使用；`limit` 最多500，`offset`按返回继续。没有显式 source 映射时不要混合不同来源的指标。
   - `ctr/cvr/acos` 为百分数；`cpc/cpa`为本币金额；零分母为 null。SP/SB 搜索词可以按渠道汇总，placement 和 product-ad 与 SP 是重叠观察视角，不能再叠加。
3. `daily.product`：仅用于具体 ASIN 的逐日经营解释。必须提供 `asin`，同时限定站点或店铺和日期，不能假设同一 ASIN 在其他站点的数值属于当前站点。区分业务数据与快照，核对 ad_scope；跨广告类型的数值不可直接与 SP+SB 比较。
4. `ads.summary` 提供逐日源记录汇总，用于日期趋势核对。`ads.sp_search_terms`、`ads.sb_search_terms`、`ads.placements` 是原始明细，默认100行，仅在需要原始记录时使用。

## 不要盲目尝试的路径

- 当前广告分析不需要先调用 `daily.metrics`。如果服务端返回“不支持的日报数据集”，记录缺口并继续使用上面的广告数据集。
- `daily.product` 缺少 `asin` 或请求超过 30 天时，不要重试相同请求；缩小到用户指定 ASIN 和最多 30 天。
- 用户要求最近 14 天时，所有数据集统一使用相同的 14 天窗口，不要自行扩大到 30、60 或 90 天。

## 收敛规则

- 先拿覆盖用户所需层级的聚合；用户明确要求活动、广告组、关键词/ASIN、广告位时，每个层级都应有数据或明确缺口，不能把“最小查询”理解成省略用户要求。下钻用于解释，完整统计由聚合完成。
- 某个数据集失败后，优先修正参数或切换到本契约中的相邻数据集，不重复发送同一个失败请求。
- 结果必须保留 `scope`、`coverage`、`data_as_of` 和 `queried_at`。

## 证据含义

完整聚合只证明已入库记录被纳入，不证明上游没有漏采。分页 coverage 描述分组返回范围，totals_by_store_report 描述全部匹配分组；二者分别使用。每个结论继承其来源的时间、实体、报告类型、单位和缺失状态。

报表没有提供实际成本、配置竞价、配置预算或历史调价记录。花费是实际消耗，不是配置预算；CPC是成交点击成本，不是配置出价；规则中的保本线是策略假设，不是本商品真实利润。建议可利用这些规则，但应说明适用条件、尚缺的成本/配置及观察验证方式。用事实包中的同一计算结果生成聊天和 PDF，不在成文时重新心算或把假设升级成事实。

## 聚合结果收集

ads.metrics 默认 result_mode=complete，宿主会按相同身份、站点、时间窗和维度自动收集全部聚合分组。limit 仅控制每页大小，完整结果写入 evidence 文件，模型消息只展示带覆盖说明的摘录。用 analysis.python 读取该文件计算；只有用户明确要单页抽查时使用 result_mode=page。自动收集会校验分页连续性与查询范围；若数据在翻页期间发生变化或文件过大，工具明确返回错误，按站点、店铺或对象分批并保持原时间窗继续收集。完整已入库聚合仍不等于上游采集已验证完整。
