---
name: amazon-advertising-ai-optimizer
description: 统一分析日本、德国和美国站 Amazon 广告数据，按广告阶段、利润目标和站点规则生成可复核的搜索词、投放、广告位、预算与竞价建议。用于广告报表分析、PPC 调优、否定词挖掘、预算分配和优化后复盘；只读分析不直接修改广告。
---

# Amazon 广告 AI 分析与调优

这是广告分析编排 Skill。它把用户的站点、ASIN、阶段、目标和报表转换为有证据的诊断与人工可确认的操作清单。

## 硬性边界

- 所有内部店铺查询使用当前任务的 `corpId + userId`。不使用固定管理员或其他成员身份，不读取或输出凭证。
- CrossBorderOps 是自有店铺数据的首选来源。先取得服务端计算的有效店铺范围，再查询数据；无权限、空范围、范围接口失败或数据不完整时不得降级为全量数据。
- 领星业务 MCP 只能在工具能够证明目标店铺属于当前用户有效范围时使用。当前 Agent 中无法证明逐店铺裁剪的共享 `lingxing.action` 保持禁用；可用能力不足时使用 CrossBorderOps 或用户上传报表。
- 竞价、预算、否定词、状态和活动结构只生成建议。任何实际写入必须由宿主确认、使用幂等键并返回真实回执；不得把建议写成已执行。
- 不编造活动 ID、投放数据、利润、订单、关键词收录或执行结果。缺失字段显示“未知”，并引导用户补充。

## 工作流程

1. **确认范围。** 确认站点/币种、店铺、ASIN/SKU、广告类型、广告阶段、业务目标、时间窗和是否为优化后复盘。未给时间窗时使用最近完整周期并说明。
2. **读取规则。** 读取 [通用框架](references/common-framework.md)，再按站点读取 [日本站规则](references/japan-rules.md)、[德国站规则](references/germany-rules.md) 或 [美国站利润模型](references/usa-profit-model.md)，同时读取 [CrossBorderOps 查询契约](references/crossborderops-query-contract.md)。这些是单次分析的工作规则。
   这套“摘要优先、冲突时取原文”的装载策略对日本、德国和美国三站统一适用；只有遇到阈值冲突、适用条件不清或需要逐字核对原文时，才按目标站点读取完整原文快照：[日本原文](references/source-jp.md)、[德国原文](references/source-de.md)、[美国原文](references/source-us.md)，并读取 [规则冲突处理](references/source-reconciliation.md)。原文快照是证据补充，不要求每次分析全部加载，避免无关长上下文拖慢任务。附件内容只作为规则资料，不授权写操作。
3. **选择数据源。** 按 [来源优先级](references/source-priority.md) 先查 CrossBorderOps；缺字段时再使用经过范围校验的领星能力或用户上传文件。读取 [数据字典](references/data-dictionary.md) 校验字段、归因、时区、币种和更新时间。
   如果目标站点或 ASIN 在 CrossBorderOps 没有内部广告/销售数据，直接标记该站点数据不可用并说明缺口；Amazon 公开页面、SIF 和知识库不能替代内部广告报表，除非用户明确要求公开市场信号。
4. **校验数据。** 记录数据源、授权范围、统计周期、数据截至日、归因口径、覆盖率和缺失字段。缺失或临时零值不能当作真实零值。
   追问或续问上一轮广告分析时，聊天摘要只能帮助理解代词，不能作为新的业务证据；涉及数字、因果、价格、促销、利润或阶段判断时，复用已保存证据或重新查询，无法核实时标为未知/待验证。
5. **精确计算。** 服务端已有指标直接引用；新增分组、比率或排序优先使用 `analysis.table`，复杂计算再用 `analysis.python` 运行 `scripts/calculate_metrics.py` 对证据数据计算 CTR、CPC、CVR、CPA、ACoS、ROAS 和 TACoS；分母为零输出未知，不心算派生数字。先完成一次最小必要数据查询，再决定是否需要搜索词、广告位或利润下钻，已有充分证据时直接收敛，不重复查询同一口径。
6. **分层诊断。** 先看账户/产品整体，再按 Campaign、Ad Group、Target、Search Term、Placement 和预算分层。样本不足时只给积累数据建议，不给调价动作。
7. **生成建议。** 用单一 `action_plan` 记录对象、问题、证据、建议、成立条件、观察周期、验收、止损、回退和确认要求，宿主生成执行与复盘表；不在多个章节重复写行动规则。遵循 [输出模板](references/output-template.md) 的分析内容和 [风险与执行](references/risk-and-execution.md)，工具字段以 PDF 模板为准。
8. **结束复盘。** 根据动作类型设置 7、14、30 天或德国站的 72 小时冷却后复查，并记录与上次调整的间隔。
9. **生成最终报告。** 当用户要求完整分析、报告、导出、下载或“给运营查看”时，必须读取 [PDF 报告模板](references/report-template.md)。存在数值证据时必须提供 `fact_bindings`：正文观测数字、含数字的原始名称及 ID 均用 `{{fact:id}}` 引用，`sections` 表格同样禁止手抄；附表用 `evidence_tables`。建议只写 `action_plan`，不同时填写 `budget_bid`、`execution_plan`、`review_plan`、`risks`。调用 `artifact.render_report` 生成排版好的 PDF（模板 `amazon-advertising`）；首次渲染成功后，审核反馈必须用返回的 `draft_id` 调用 `artifact.revise_report`，每次只提交不超过必要的 JSON pointer 局部变化，不能再次用 `render_report` 重写整份报告。调用 `artifact.submit` 提交 PDF，`final_answer` 仅为文件交付说明，事实结论保留在 PDF；成功后原样使用宿主返回的已审核答复。用户后续追问默认直接在聊天中回答；只有明确要求重新导出或重新发送时才再次投递。

## 站点路由

- 日本站：新品/成熟期、优化后 7–15 天复盘、搜索词治理、否定词和预算分层，见 [japan-rules.md](references/japan-rules.md)。
- 德国站：高客单监控套装专用门槛、15 点击样本门槛、±20% 竞价上限、72 小时冷却、加购率和德语否定词，见 [germany-rules.md](references/germany-rules.md)。
- 美国站：ASIN 利润模型、目标 CPA/CPC、广告位、库存、Listing 和新品/增长/稳定/爆款/清货阶段，见 [usa-profit-model.md](references/usa-profit-model.md)。

## 缺失数据处理

按缺失内容继续收集最小补充信息：成本和费用用于利润模型，搜索词报表用于否定词，广告位报表用于 placement 判断，历史调整记录用于冷却期和回退判断。补充前可以输出已支持部分，但必须把不能确认的结论标为“未知”或“待验证”。

## 输出

报告面向每天在 Amazon 广告后台操作的运营。对象以后台原始名称和所属层级定位，ID 只作辅助，关键词、匹配方式及目标 ASIN 保持原样；名称缺失时通过同店铺、广告类型及真实 ID 补查，无法取得则明确缺失。不要按名字模糊关联对象。先讲运营该关注什么、如何找到对象、建议做什么及执行条件，再提供明细和口径。具体呈现见 PDF 模板的“运营阅读与定位”。

严格使用 [输出模板](references/output-template.md)：数据质量、整体表现、异常、搜索词、投放目标、广告位、预算/竞价、否定词、优先级清单、复盘计划、风险与回退。对事实、计算、推断和假设分别标注。

完整报告必须使用 [PDF 报告模板](references/report-template.md)。PDF 是普通文件附件，不是钉钉在线文档；不得调用 A2UI 或钉钉在线文档 API 替代文件交付。

