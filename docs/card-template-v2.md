# AI 流式卡片模板：过程区与答案区

当前模板：`9c43b986-c7de-487b-9c43-71d91631d658.schema`（替代 `e08def5f-27fb-451b-ab01-cc568915bfee.schema`）。

2026-09-22 录屏发现：旧布局在工具阶段提前进入“输出中”，AI 富文正文空白时仅显示 `...`；过程文案与完成状态也会重排。下一版模板须按状态分区：

- **处理中**：保留 AI 加载中组件，在组件的“提示文本”绑定 `activity`，显示当前工具；静态加载文案不写省略号。
- **输出中**：只显示绑定 `content` 的 AI 流式富文；移除原先这里绑定 `activity` 的基础文本（或者在 `activity` 为空时条件隐藏）。
- **完成**：与“输出中”的正文区域保持同样宽度、内边距和组件结构，只显示最终 `content`。不要另设操作区、任务编号或完成标题。

`activity` 是普通文本变量，`content` 是富文本变量。后端在工具阶段更新 `activity` 且维持 `flowStatus=1`；第一个非空答案写入 `content` 时才进入输出状态，随即清空 `activity`；最终只 finalize，不再次清空活动字段。

建议状态布局：

```text
┌────────────────────────────────┐
│  处理中：动画 + activity          │
│  输出中：Markdown 正文           │  ← content，AI 流式富文
│  完成：同一正文区域              │  ← content，AI 流式富文
└────────────────────────────────┘
```

编辑器修改模板需要重新创建。新模板 ID 已写入 `.env` 的 `DINGTALK_CARD_TEMPLATE_ID`，并启用 `DINGTALK_CARD_ACTIVITY_IN_PROCESSING=true`。

当前 `.env` 已启用 `DINGTALK_CARD_ACTIVITY_VARIABLE=activity`。Gateway 已重建、重启，并验证容器配置与就绪状态；仍需在钉钉客户端观察布局，接口成功不代表视觉正确。

验收时用一个只读工具任务观察：①处理状态出现；②工具名称只在 `activity` 更新；③答案只在 `content` 递增长出；④完成后 `activity` 消失且答案不回退。钉钉客户端实际观感必须由截图或录屏确认，接口 200 不足以证明布局正确。
