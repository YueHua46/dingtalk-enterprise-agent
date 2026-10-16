# Amazon 广告 PDF 报告模板

> 本文件是已退役的历史资料，仅供审计旧任务使用。新任务不得读取或调用其中的旧模板能力；PDF 统一使用 `artifact.render_document` 与 `artifact.revise_document`，由 HTML/CSS 按本次问题自由编排。

只有用户明确要求 PDF、导出或下载时才生成 PDF 普通文件附件，发送到原群聊或私聊。用户只说“分析”或“报告”时默认在聊天中回答。不调用在线文档、钉盘写入或 A2UI 替代文件交付；PDF 只保留与本次问题相关的章节。

## 生成与修正

1. 用本任务完整证据及 `analysis.table` / `analysis.python` 完成必要计算。已有指标直接引用，缺失不当零；没有成本不能宣称盈利，没有配置不能将消耗当预算。
2. 新任务不得使用本文件中的历史结构；请改用通用文档块按问题自由组合。
3. 历史文件需要修正时，重新生成通用文档，不恢复旧广告模板。
4. 调用 `artifact.submit`，`path` 原样取自宿主最新返回值。`final_answer` 仅写文件交付说明，例如“广告分析报告已发送，请查看附件。”，事实结论仅在 PDF 中。只有真实 `delivered` 回执才表示发送成功，成功后用 `reviewed_final_answer` 原文结束。不要提交中间 JSON 或临时图片。
5. 后续追问默认聊天回答，不重复发送 PDF；明确要求重新导出或重新发送时才再次投递。

## 事实编译契约

当证据包含数值观测或计算表时，`fact_bindings` 必填。所有正文观测数字、含数字的原始名称、ID 和 ASIN 使用 `{{fact:id}}`，不手抄。此要求也覆盖 `executive_summary`、数据质量描述、命名指标表、`sections.paragraphs` 和 `sections.rows`；不能把数字放到自由表或写成“建议”绕过事实校验。

绑定字段为 `{id,evidenceId,rows_path,where,field,decimals?,suffix?}`。id 使用 ASCII 字母开头；证据 ID、路径、字段及筛选值必须来自本任务证据索引。where 精确选中唯一行，并保留店铺、来源及所需对象维度；汇总先计算成单行，不能用单对象代替总体。宿主核对原文件哈希、行和字段后填值，百分号仅附加、不缩放。范围、币种、完整性、关联与因果仍需按证据说明。

数字附表使用顶层 `evidence_tables`，选择真实 evidenceId、rows_path、columns 与 limit，由宿主从文件填入。自由 `sections` 表的 columns 与每行 rows 长度一致，事实单元格仍用绑定引用；缺失用 null 或“未知”。不要将原始字段 keyword、spend、acos 直接塞入不支持这些列的命名表。

标题、站点、期间和来源等元数据写实际范围；它们不是观测指标入口。建议幅度、观察周期、验收与止损阈值写入 `action_plan` 对应建议字段，明确是建议及成立条件，不放入 problem 或 evidence 冒充观测。仅在没有数值来源的无数据或文本证据报告中，可不提供数值绑定，并如实说明缺口。

## 单一行动计划

`report.action_plan` 最多包含二十条对象记录，每条严格使用以下字段，值均为非空字符串：

`id, priority, object, problem, evidence, proposal, conditions, observation, acceptance, stop_loss, rollback, confirmation`

- `id` 是 ASCII 标识；`object` 与 `evidence` 必须包含事实引用。对象沿店铺、活动、广告组、关键词及匹配方式定位，引用真实名称和必要 ID；不凭相似名称关联。
- `proposal` 写建议动作及幅度，`conditions` 写实施前提或备选动作优先关系，`observation` 写统一观察安排；`acceptance`、`stop_loss`、`rollback` 分别写验收、立即止损条件与回退动作，`confirmation` 写真实修改的确认要求。
- 使用行动计划时禁止同时提交非空 `budget_bid`、`execution_plan`、`review_plan` 或 `risks`。宿主从同一记录生成这四表，保持对象、周期、止损与回退一致。不要在 sections 再重复行动或复盘规则；sections 用于诊断、口径及待验证解释。

## 有数值证据的结构示例

以下仅示范协议；证据、字段和筛选值须替换为本任务真实索引，不把示例当业务数据。同对象指标来自同一行；新增比率先计算。

```json
{
  "template": "amazon-advertising",
  "fact_bindings": [
    {"id":"campaign","evidenceId":"本任务真实证据ID","rows_path":"data.rows","where":{"campaign_id":"真实活动ID"},"field":"campaign_name"},
    {"id":"campaign_id","evidenceId":"本任务真实证据ID","rows_path":"data.rows","where":{"campaign_id":"真实活动ID"},"field":"campaign_id"},
    {"id":"spend","evidenceId":"本任务真实证据ID","rows_path":"data.rows","where":{"campaign_id":"真实活动ID"},"field":"spend","decimals":2},
    {"id":"acos","evidenceId":"本任务真实证据ID","rows_path":"data.rows","where":{"campaign_id":"真实活动ID"},"field":"acos","decimals":2,"suffix":"%"}
  ],
  "evidence_tables": [{
    "title":"活动指标","evidenceId":"本任务真实证据ID","rows_path":"data.rows",
    "columns":[{"field":"campaign_name","label":"后台原始活动名称"},{"field":"campaign_id","label":"活动 ID"},{"field":"spend","label":"花费（来源币种）"},{"field":"acos","label":"ACoS (%)"}],"limit":30
  }],
  "report": {
    "report_title":"广告分析","marketplace":"实际站点","analysis_period":"实际起止日","store_name":"实际范围",
    "executive_summary":"活动 {{fact:campaign}} 花费 {{fact:spend}}，ACoS 为 {{fact:acos}}；实际利润未知。",
    "data_quality":{"成本":"未提供","范围":"仅本任务已入库结果，上游完整性未验证"},
    "sections":[{"title":"诊断依据","columns":["对象","ACoS"],"rows":[["{{fact:campaign}}","{{fact:acos}}"]],"paragraphs":["当前累计指标不证明趋势稳定，须核对分日变化。"]}],
    "action_plan":[{
      "id":"campaign_review","priority":"优先复核","object":"活动 {{fact:campaign}} / {{fact:campaign_id}}",
      "problem":"优先核对广告归因效率与经营目标是否相符","evidence":"花费 {{fact:spend}}，ACoS {{fact:acos}}",
      "proposal":"建议核对配置后进行小幅预算测试，实际幅度待经营目标确认",
      "conditions":"先核对成本、当前配置及预算是否受限，未满足条件则仅观察",
      "observation":"建议每日观察、七天复查","acceptance":"确认新增订单与增量花费满足经营目标",
      "stop_loss":"建议出现无新增订单且增量花费超过确认的试验上限时立即触发",
      "rollback":"恢复测试前配置","confirmation":"实际修改须发起人确认"
    }]
  }
}
```

## 运营阅读与定位

第一屏给出关注对象、判断与决策缺口。原始名称保持语言、大小写和符号；ID 辅助定位，不只显示长 ID。查询保留 campaign_name、ad_group_name、*_variants 与 *_name_source；名称缺失时在有效范围内补查，未取得则写“原始名称未取得”。当前名称不证明历史名称、产品类型或投放阶段。

金额标币种，百分比标单位，日期写实际期间。未知、零值、未覆盖分别说明；授权范围不等于数据覆盖。汇总和明细来自同一份证据，展示精度服务运营判断。报告保留完整指标和必要诊断，行动内容由单一记录生成。内部证据 ID、脚本、draft_id 与审核流程不得写成运营建议或聊天交付说明。
