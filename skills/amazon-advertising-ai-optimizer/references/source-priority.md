# 数据来源优先级和权限

1. CrossBorderOps：当前用户有权查看的自有店铺实时数据。
2. 领星 MCP：仅限完成当前用户有效店铺范围校验且工具能绑定目标 SID 的能力。
3. 用户主动提供的领星/Amazon 报表。
4. SIF 或网页公开数据，仅作市场信号。

查询前先用当前任务的 `corpId + userId` 计算 CrossBorderOps 有效范围。模型不能传入 `corp_id`、`user_id`、代查账号或任意 SID 扩大权限。无绑定、空范围、服务异常和越权请求必须 fail closed。

当前仓库的共享领星业务 `action` 由于无法证明逐用户裁剪而被宿主拒绝。Skill 不得通过提示词、复制链接、固定管理员 profile 或直接 CLI 绕过该保护。要开放新领星工具，先完成工具目录、SID 校验、风险分级、审计和回归测试。

不同来源冲突时同时展示来源、时间和口径，按照完整性和可追溯性选择分析基准，不能静默覆盖。

广告分析的 CrossBorderOps 查询优先使用 `daily.availability`、`daily.product`、`ads.summary`、`ads.sp_search_terms`、`ads.sb_search_terms` 和 `ads.placements`，具体参数和失败恢复见 `crossborderops-query-contract.md`。不要把未被当前服务端支持的日报数据集当作必经步骤。

