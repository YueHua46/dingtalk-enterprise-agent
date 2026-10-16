# Agent 通用单选澄清卡

模板文件：[agent-clarification-choice-dynamic.json](../templates/agent-clarification-choice-dynamic.json)

## 导入

在钉钉卡片搭建器中选择“更多 → 导入卡片模板”，导入 JSON 后保存并发布到当前应用。发布后把生成的模板 ID 配置给 Agent；模板必须使用 `callbackType=STREAM`，这样提交按钮才会回到应用的卡片回调主题。

## 卡片内容

- 顶部标题、单选区域标题、补充说明标题和输入提示都由 `cardData` 动态提供。
- 单选项由 `singleCheckboxItems` 动态提供，卡片本身不绑定广告、站点或某个 Skill 的固定问题。
- 补充说明输入位于选项之后，文案由 `freeTextLabel` 和 `freeTextPlaceholder` 提供。
- 底部有 `continueText` 和 `cancelText` 两个动作，分别使用动作 ID `single_button_node_oclw9159003` 和 `single_button_node_cancel`。

模板使用钉钉原生 `Input`、`CheckboxList` 和 `SingleButton`，投放时使用机器人 `robotCode`。选项和输入值会在动作回调中一起返回。

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
