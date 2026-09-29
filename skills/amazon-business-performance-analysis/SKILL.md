---
name: amazon-business-performance-analysis
description: 基于 CrossBorderOps 后台、领星等授权来源的真实店铺数据，诊断 Amazon 自营业务的销售、流量、转化、广告、库存与利润变化，并给出有证据和优先级的运营结论。用于“分析店铺经营”“为什么销量下降”“哪些 ASIN 要优先处理”“做经营周报”等请求；竞品公开数据研究或单项广告搜索词报告优先使用对应专项 Skill。
---

# Amazon 店铺经营分析

面向当前用户有权查看的店铺，完成从经营结果到原因、再到行动建议的诊断。当前钉钉 Agent 实时经营数据使用按用户店铺范围裁剪的 CrossBorderOps 后台；也可以分析用户提供的报表。领星共享密钥的通用业务工具尚未实现逐店铺隔离，不能用于当前用户的实时取数。不要依赖 SP-API 或 Amazon Selling Partner Connector。

在本项目的钉钉 Agent 中，使用 `reference.read_guide` 读取本 Skill 和下列参考资料：`name` 固定为 `amazon-business-performance-analysis`，`reference` 传参考文件名（不带 `.md`）。

取数与计算纪律：优先用一次服务端查询覆盖所需对象，不要逐个 ASIN 重复调用 `daily.product`。汇总、排名、站点合计、漏斗与广告诊断、两期对比都用 `daily.metrics`（例如某站点总量：`dimensions=["site"]` 或看 `totals_by_site`；原因诊断：`daily.performance_changes` 找出下滑 ASIN 后，用 `daily.metrics` 带 `asins`、`compare="previous_period"` 一次取流量、转化、广告与 Listing 状态）。服务端已计算的合计与比率可直接引用；另外需要的派生数字（二次汇总、占比、贡献度等）都用 `analysis.python` 读取该查询保存在 `evidence/` 下的结果文件计算（文件清单见 `evidence/index.json`），答复中的数字与计算输出保持一致。

## 工作方式

1. **确定分析范围与动作。** 保留用户给出的店铺、站点、ASIN/SKU、时间段、指标和分析动作。开放式发现问题以当前用户全部授权店铺为范围，选择能支持原目标的服务端查询；不要要求用户先给出本应由数据发现的店铺或 ASIN。相对自然时间按当前会话日期和站点时区解释；未给日期时采用与目标相符的最近完整期间，并说明默认值。只有变化分析才引入基线和等长比较。缺失条件会改变查询对象、使结果失真或涉及真实写入时才追问。不要混合不同站点、币种、时区或多个卖家账户。
2. **核对数据定义。** 读取 [数据口径](references/data-contract.md)；领星数据读取 [领星适配](references/lingxing-adapter.md)，CrossBorderOps 数据读取 [后台数据适配](references/crossborderops-adapter.md)。先确认报表字段、时间粒度、归因口径与数据更新到哪一天，再计算。若某项来源不可用，使用现有数据完成可支持的分析并说明缺口。
3. **按原目标定量分析。** 从销售额、订单/销量、流量、转化、可售库存及利润中选择用户所问的指标；按所问时段和对象完成筛选、聚合、排序或比较。仅在用户要求变化时计算基线和差额，仅在要求原因时下钻诊断。按问题类型读取 [诊断方法](references/diagnostic-playbooks.md)。不要为一项简单问题拉取所有报表。
4. **核查替代解释。** 对销量下降，检查流量、转化、客单价/售价、缺货、Listing 状态、广告与促销变化；只分析有数据的分支。库存问题读取 [库存与补货](references/inventory-analysis.md)。利润问题确认成本与费用覆盖后再判断净利。
5. **形成结论。** 读取 [证据与输出](references/evidence-and-output.md)，区分事实、计算、推断与待验证假设；给出影响规模、证据、优先级和下一步。没有可靠证据时明确说“目前无法归因”，并指出最有价值的补充数据。

## 与现有 Skill 配合

- 这是跨销售、流量、库存和利润的总诊断入口。深挖搜索词时转用 `zach-search-term-report-analyzer`；CVR 与自然排名阈值用 `zach-sif-cvr-threshold-analyzer`；前台 Listing 健康用 `zach-listing-health-checker`。
- 利润/FBA/广告等专项可参考已安装的 Nexscope 子 Skill，但其通用基准或估算不得覆盖领星真实数据，也不得当作已核实的平台规则。
- `amazon-seller-analytics` 用于公开竞品店铺估算；本 Skill 用于有权限的自有店铺经营数据。

## 边界

- 本 Skill 只负责读取、计算和建议。价格、广告、Listing、库存计划等真实变更由相应业务工具与宿主确认流程处理；分析请求本身不授权执行修改。
- 当前用户的店铺授权、数据隔离和确认规则由宿主执行。只调用本会话可用的工具，不借用其他用户身份或跨会话原始数据。
- 不编造指标值、利润或“官方阈值”。不要使用共享密钥的领星通用 `action` 取数；这条路径目前无法证明结果只包含当前用户获准店铺。
- CrossBorderOps 实时 API 必须经当前钉钉用户与后台授权关系计算出有效店铺范围，并沿用后台的店铺权限。授权关系可以继承现有后台账号店铺，也可以直接指定店铺；同一用户多条映射取店铺并集。显式映射到后台 `superuser`/`admin` 账号时，按后台原有规则继承全部可用且已采集店铺；这不允许 Agent 自行借用管理员身份。不能按国家、TAG、姓名或部门推算权限。没有完成绑定或没有授权工具时，可分析用户提供的后台导出文件，但不能借用服务器登录态、管理员账号或直接查询数据库替用户取数。

## 方法来源

本 Skill 为本项目重新编写的数据源无关分析流程，吸收了 Amazon [Selling Partner Agentic Toolkit](https://github.com/amzn/selling-partner-agentic-toolkit) 中 `seller-analytics`、`stockout-prevention` 与 `sp-sales-drop` 的指标发现、库存风险和销售下降排查思路。原项目版权归 Amazon.com, Inc. or its affiliates，按 Apache-2.0 许可发布。这里不复制其 SP-API/MCP 调用实现。
