# A2UI JSON 卡片迁移

基线：DWS v1.0.63（2026-10-03）。JSON 布局不需要预建模板。

## 已实现：展示能力

- `a2ui.explain` 查询内置组件、函数和 Token 文档。
- `a2ui.show_sections` 复用固定 JSON 骨架，展示分组结果、步骤和折叠内容。
- `a2ui.present` 由 Agent 自由构建组件布局与 dataModel；组件按 ID 引用。
- 宿主生成 surfaceId，按发起任务的 corpId/userId 绑定 DWS profile，固定发送到原会话，默认禁止转发。
- 发送前执行 `aicard lint --preflight new-card --emit`，同时检查语法、协议、根组件和引用闭包。
- 使用现有持久化写入台账防止重复发送；状态未知不重试。创建成功后使用真实 bizId 完结卡片。
- 返回 `accepted` 和 `renderingVerified: false`，区分服务端受理与客户端渲染证据。
- 简单问答用文字，布局或发送不可用时回退文字。最终结论继续通过原有证据核验。

当前仅开放 Column、Row、Text、Markdown、Card、CollapsiblePanel、Divider。业务按钮、表单、函数与外部 Catalog 暂不开放。

## 后续交互迁移

1. 任务进度：固定 JSON 骨架，数据模型更新状态和正文；关联真实 bizId、原消息及任务取消。
2. 澄清选择：宿主登记候选与表单 schema，返回事件绑定 corpId、userId、原会话、任务及有效期；不把事件正文当作工具调用授权。
3. 高危确认：宿主固定同意/拒绝 JSON，继续使用现有 challengeId、仅发起人确认、5 分钟过期、拒绝不重试规则。
4. 自由业务交互：Agent 构建界面，宿主登记允许动作、校验输入，回调重新走业务工具权限与确认流程。防止伪造事件、跨群操作、重复点击及过期按钮。

确认卡的业务动作和安全字段必须由宿主生成。自由布局可以改变展示方式，不能改变操作授权。

现有任务流式卡和高危确认卡目前仍使用旧模板。需在真实钉钉客户端验证 JSON 渲染、事件载荷、更新和完结，再切换宿主生命周期；本次未部署或向实际会话发送测试卡。

## 验证与环境问题

构建、单元测试，以及 DWS v1.0.63 离线 new-card preflight。CLI lint 不能证明实际客户端渲染。

本机 v1.0.63 的 leaf Schema 查询出现 `Schema cache repair requires the isolated builder`；lint/explain 可用。发送/更新参数已按该版本 leaf Help 核对，正式上线前需修复 Schema 缓存并验证真实受理结果。

来源：[DWS v1.0.63 发布说明](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.63)、[JSON 构建卡片文档](https://open.dingtalk.com/document/development/json-build-card)。
