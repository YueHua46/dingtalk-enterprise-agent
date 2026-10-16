# Agent 通用单选澄清卡

模板文件：[agent-clarification-choice-dynamic.json](../templates/agent-clarification-choice-dynamic.json)。如果使用最新的“样式修正版”导出文件，字段契约保持一致，直接在配置中填入发布后的模板 ID 即可。

## 导入

在钉钉卡片搭建器中选择“更多 → 导入卡片模板”，导入 JSON 后保存并发布到当前应用。发布后把生成的模板 ID 配置给 Agent；模板必须使用 `callbackType=STREAM`，这样提交按钮才会回到应用的卡片回调主题。

## 卡片内容

- 顶部标题、单选区域标题、补充说明标题和输入提示都由 `cardData` 动态提供。
- 单选项由 `singleCheckboxItems` 动态提供，卡片本身不绑定广告、站点或某个 Skill 的固定问题。
- 补充说明输入位于选项之后，文案由 `freeTextLabel` 和 `freeTextPlaceholder` 提供。
- 底部有 `continueText` 和 `cancelText` 两个动作，分别使用动作 ID `single_button_node_oclw9159003` 和 `single_button_node_cancel`。

模板使用钉钉原生 `Input`、`CheckboxList` 和 `SingleButton`，投放时使用机器人 `robotCode`。选项和输入值会在动作回调中一起返回。Agent 已接入这张卡：只有模型调用 `agent.workflow` 的 `clarify`，并判断用户独有的关键选择会实质改变对象、业务目标、验收结果或操作目标，且不存在安全合理默认值时才投放。可用合理默认值的低风险问题继续自动处理，模板未配置时回退为原有文字澄清。先读取相关 Skill 和可核查的数据，通常最多问一轮，必要时第二轮；用户明确要求 PDF 时直接生成 PDF。

## Agent 配置

发布模板后设置 `DINGTALK_CLARIFICATION_CARD_TEMPLATE_ID`。可选的 `DINGTALK_CLARIFICATION_CARD_TTL_MS` 默认 24 小时。模板动作 ID 必须保持 `single_button_node_oclw9159003`（继续）和 `single_button_node_cancel`（取消），回调类型使用 `STREAM`。

模型需要提供选项时，在 `agent.workflow` 的 `clarify` 中传入 `options`（2–4 个 `{value,text,checked?}`）；不传时只保留补充说明，不捏造推荐方案。宿主使用已保存的选项解释选择索引，不信任回调带回的选项文案。没有选择也没有填写时继续等待。卡片通过唯一实例 ID 找到原任务，校验发起人身份；企业与原会话从已保存任务绑定，回调带企业字段时额外校验。使用数据库事务原子消费任务状态，防止重复点击或文字/卡片同时回答引起重复恢复。选择卡片不会授权任何业务写操作；预算、竞价、否定词、权限等高危写入仍走独立的宿主确认卡。

升级部署须先运行数据库迁移（新增 `024_clarification_card.sql`），再启用模板配置。卡片提交、取消或过期后按钮禁用；服务重启后保留待澄清状态及剩余有效期，不自动继续。

## 创建时的数据

创建卡片时，`cardData` 至少传入以下字段；所有文案和选项都可以按任务替换：

```json
{
  "title": "你希望我重点帮你做什么？",
  "choiceLabel": "选择关注方向",
  "freeTextLabel": "补充说明（可选）",
  "freeTextPlaceholder": "例如：我更关心美国站、预算浪费或某个 ASIN",
  "continueText": "继续",
  "cancelText": "取消",
  "lastMessage": "请选择一个方向，也可以补充说明",
  "singleCheckboxItems": [
    { "value": 0, "text": "整体表现：先给我总体判断", "checked": false },
    { "value": 1, "text": "优先问题：找最值得先处理的对象", "checked": false }
  ]
}
```

`singleCheckboxItems` 的每一项使用 `{ value: number, text: string, checked: boolean }`。`value` 是业务方可定义的数值标识；回调同时带回选中索引和这份选项数组，业务方应按索引读取对应项。模板内置的交互状态字段为 `submitBtnStatus`、`input` 和 `errMsg`。提交后宿主应将卡片更新为 disabled 状态，避免重复点击。

## 回调解释

提交按钮的回调参数位于卡片回调的 `cardPrivateData.params` 中，主要读取：

- `input`：用户补充说明；
- `singleCheckbox`：单选结果的索引；
- `singleCheckboxItems`：投放时使用的动态选项数组；
- `actionIds`：本次提交的组件动作标识。继续和取消分别由 `single_button_node_oclw9159003`、`single_button_node_cancel` 区分。

宿主应通过卡片实例的 `outTrackId` 找到等待中的任务，不把内部任务 ID 放进用户可见文本中。

回调处理必须继续校验当前用户、企业、原会话、任务状态、有效期和一次性幂等键。选择结果只用于补充 Agent 意图，不能直接作为业务写操作授权；涉及写入时仍要走原有高危确认卡。

## 适用边界

这是一张通用澄清卡，不绑定广告、国家站点或某个 Skill。后续如果某类任务需要不同选项，Agent 可以在聊天正文中解释选项含义，或者再维护同样结构的业务卡；不要为日本站、美国站、德国站分别创建 Workflow 卡片。

模板 JSON 已完成本地 JSON 解析、动态字段和动作结构检查。钉钉卡片搭建器导入、机器人实际投放和手机/PC 客户端回调仍需在你的应用环境中验收。
