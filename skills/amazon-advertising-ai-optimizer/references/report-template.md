# Amazon 广告 PDF 报告模板

当用户要求完整分析、报告、导出或可下载结果时，必须在本次分析完成后生成 PDF。PDF 是普通文件附件，不是钉钉在线文档。

## 生成步骤

1. 把已经通过工具取证和 `analysis.table` 或 `analysis.python` 计算的结果整理为结构化 JSON。
2. 调用 `artifact.render_report`，传入 `template="amazon-advertising"` 与 `report` 对象。该工具已经封装字体、排版、分页与运行环境；在本宿主内使用此工具，不需要编写或调试 PDF 代码。
3. `sections` 可承载活动、广告组、投放对象、ASIN 等任意分析维度，不要为适配模板省略用户要求。每节含 `title`、`paragraphs`，可选 `columns` 与 `rows`（每行列数一致，第一列为对象）。工具会将超过 6 列的宽表自动拆成相邻表格、重复对象列，保留全部指标。
4. 调用 `artifact.submit`，path 必须原样使用 render_report 返回的 path（由宿主生成唯一文件名），并以 final_answer 提供完整最终聊天摘要。宿主联合审核文件正文与摘要，通过才发送；成功后用返回的 reviewed_final_answer 原文结束，避免重新生成同义摘要引入新结论和重复审核。返回修正意见时一并修正文件与摘要后再提交。不要提交中间 JSON、页面 PNG 或临时文件。
5. 最终聊天消息只说明报告已发送，并给出不超过三条主要结论。后续追问默认只在聊天中回答，不重复发送 PDF。

## JSON 字段

必填顶层字段：`report_title`、`marketplace`、`analysis_period`、`store_name`、`executive_summary`、`data_quality`。

`asins` 与 `advertising_stage` 为可选字符串；data_quality 是键值对象，值为字符串、数字、布尔或 null。

可选数组字段：`overall_metrics`、`anomalies`、`search_terms`、`targets`、`placements`、`budget_bid`、`negatives`、`execution_plan`、`review_plan`、`risks`、`sources`。除 sources 是字符串数组，其余这些数组的每一项必须是对象，不能传字符串或 JSON 字符串。字段缺失时填写“未知”，不能补造数据。

优先使用通用 sections 描述分析，以 evidence_tables 绑定数值表。若使用命名表，字段必须是对象；表格允许补充 `severity`、`metric`、`description`、`impact` 等运营字段，渲染器会把它们放入对象详情。overall_metrics 的一行例如 `{"metric":"CPC","value":2.5,"benchmark":"未知","status":"观察值"}`，不是 `"CPC: 2.5"`。

每项建议至少包含对象、问题/证据、动作、调整值或观察周期、验收指标、止损线、回退条件和人工确认状态。脚本会自动生成封面、指标表、分章节表格、页眉页脚和页码，并支持中文字体。

## 文件交付规则

- PDF 发送到发起请求的原群聊或私聊，由宿主使用当前用户身份完成投递。
- 不使用钉钉在线文档 API，不写入钉盘，不调用 A2UI。
- 文件发送成功后，聊天回复使用自然语言确认；不得声称“已发送”而没有 `artifact.submit` 的真实回执。
- 用户明确要求“重新导出”“重新发送最新版”时才重新生成或投递。

## 同一份分析内容

先用完整证据文件在 analysis.python 中计算跨页聚合、筛选与建议依据，再将结果整理为 report；聊天结论与报告使用这份相同口径的分析。服务端已计算的指标可直接使用，不需要为每个比率另起一次模型计算。来源记录明确证据文件、周期、站点、广告类型、对象层级及缺失项。业务规则阈值、条件性建议和实际经营事实分清；没有成本不能把效率分档解释成已证实的利润，没有配置不能把观察到的消耗解释成配置预算。

## 数值表直接绑定

使用顶层 evidence_tables，模型只选择已经取得的 evidenceId、实际表路径和列名，宿主填入数值；无需手抄或把 JSON 编码成字符串。以下仅为结构示例，ID 和列名须从本任务证据索引取得：

```json
{
  "template": "amazon-advertising",
  "evidence_tables": [{
    "title": "活动指标",
    "evidenceId": "本任务真实证据ID",
    "rows_path": "data.rows",
    "columns": [{"field":"campaign_name","label":"后台原始活动名称"},{"field":"campaign_id","label":"活动 ID"},{"field":"spend","label":"花费（店铺本币）"},{"field":"acos","label":"ACoS (%)"}],
    "limit": 30
  }],
  "report": {
    "report_title": "广告分析", "marketplace": "实际站点",
    "analysis_period": "实际起止日", "store_name": "实际范围",
    "executive_summary": "有证据的结论",
    "data_quality": {"范围":"实际来源和缺口"},
    "sections": [{"title":"诊断与建议","paragraphs":["有依据的解释与待验证条件"]}]
  }
}
```

自由表格使用 sections 的 columns（列名数组）和 rows（单元格数组的数组），两者长度对应；不要把自由表格的行格式放入 overall_metrics 等命名表。数字未知用 null 或“未知”。完整数据范围与本表展示的行数分别说明。

命名表使用以下准确字段名。指标明细优先用 evidence_tables 或 sections；不要把 keyword、spend、acos 等原始行字段直接传给命名表，未支持的字段会被拒绝，避免生成空白指标。

| 命名表 | 每行字段 |
| --- | --- |
| overall_metrics | metric, value, benchmark, status |
| anomalies | priority, object, issue, evidence, action |
| search_terms | term, classification, evidence, recommendation, confirmation |
| targets | target, issue, evidence, recommendation, review |
| placements | placement, traffic, efficiency, recommendation |
| budget_bid | object, current, recommendation, observation, rollback |
| negatives | term, match_type, evidence, recommendation, language_note |
| execution_plan | priority, object, action, acceptance, confirmation |
| review_plan | when, check, acceptance, rollback |
| risks | risk, impact, mitigation, rollback |

anomalies、budget_bid、execution_plan 的对象详情可额外携带说明字段；其他命名表只接受上表字段。

## 运营阅读与定位

- 第一屏给出本期表现、最值得处理的事项与影响决策的数据缺口。按用户目标选择章节，不用空泛模板掩盖缺失的诊断。
- 对象沿“店铺 / 站点 / 广告类型 → 原始活动名称 → 原始广告组名称 → 关键词（匹配方式）或目标 ASIN”呈现；只展示当前层级所需路径。名称保留原始语言、型号、符号和大小写，中文解释另写，不改名。ID 作为辅助小节或明细列，不能只展示长 ID。同名对象用店铺与 ID 区分；重命名以查询期间最近原名显示并说明别名。名称不证明产品类型或投放阶段。
- 查询 campaign/ad_group/target 时保留 campaign_name、ad_group_name、*_variants 与 *_name_source。宿主优先使用期间报表和同范围快照；缺失时会按已授权店铺、广告类型、ID 补查当前原始名称，来源时间见 *_name_source。当前名称不证明历史名称、真实竞价、产品型号或阶段。计算按真实店铺、report 和 ID 关联名称，不能跨店铺或凭相似名字合并。未匹配则写“原始名称未取得”，保留 ID。
- 行动清单让运营看懂“找到谁 → 为什么关注 → 建议做什么 → 什么条件下执行 → 何时复查、何时撤回”。优先级写清轻重缓急及依据；自拟筛选门槛放在方法说明，不能包装成已配置规则。尚待核实的事项和可执行建议分开呈现。实际竞价/预算未知时，不用 CPC/花费替代当前设置。
- 复杂建议用 sections 的段落或每对象小节，避免把完整对象路径、长解释和多个动作都挤入五列窄表；表格保留短指标便于横向比较。保留所有必要内容，通过分层展示提高可读性，不靠删减内容或缩小字体。
- 金额标币种，百分比标单位，时间写实际日期；首次出现专业缩写给简短中文解释。未知、零值、未覆盖分别说明。汇总和明细只使用同一份计算证据，展示精度服务运营判断，原始数据保留。
- 聊天摘要使用同样的原始称呼，说明 PDF 已发送，给出最多三条关键结论及必要限制。不要把内部证据 ID、计算脚本或审核流程写成运营建议。
