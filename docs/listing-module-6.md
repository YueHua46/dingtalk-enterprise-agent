# 模块 6：统一模型接口与结构化生成

`StructuredModel.complete(request, signal)` 是宿主统一的结构化文本接口，支持注入 mock。`ResponsesStructuredModel` 复用宿主 MODEL_BASE_URL、MODEL_API_KEY、MODEL_NAME，经 Responses HTTP 接口生成；没有启动 Codex 对话线程，也没有使用 enterpriseTools、DWS、紫鸟、shell、浏览器或文件执行工具。请求显式设置 tools=[]、tool_choice=none、store=false，拒绝重定向。工具调用、非文本响应、拒绝、未完成响应和异常格式都失败关闭，不执行输出中的动作。

`ListingGenerationService.generate(prepared, factBook, plan, resolvedRules, {signal})` 消费模块 1/2/3/5 的当前任务快照。校验同用户、同会话、同请求、事实版本和规则范围，输入缺失/冲突时不调用模型。新品拒绝页面来源事实；优化可保守使用页面事实并标注未经独立核实。生成过程中保存输入快照，避免并发修订污染引用或版本。

## 输入与输出

模型得到可用本品事实、完整原值与出处片段、有效关键词、样本主题、规则及待核实提示。优化任务另带原 Listing 数据。不会发送身份、文档链接、全部产品资料正文或原始竞品评论；所有资料和目标都在数据消息中，不能覆盖系统指令。参数原值中的否定、费用、条件和单位均保留。源码提示词及策略的版本/哈希存入结果元数据。

输出字段为 title、bullets、description、searchTerms、中文修改原因和待核实事项。标题、每条五点和描述均带事实性短语的 text/start/end/factIds；索引采用 JavaScript UTF-16，end 不包含末尾。代码检查严格 JSON 结构、引用存在、出处范围精确匹配、引用不重叠、重复引用、关键词依据；拒绝额外工具/action 字段。暂无产品事实支持的关键词不应被强制填入后台词，允许留空。

**模块 6 只产出 draft_unvalidated，不产出校验通过或可上传状态。** 有效 factId 不证明英文释义正确；比如“室内摄像头”被错误改成“防水摄像头”仍可能携带有效 ID。因此结构和引用通过不等于事实、数字、长度或禁词校验通过。非数字声明受控表达、覆盖率、限定条件和数字/单位检查属于模块 7；不允许现在将这类草稿放进后续可直接复制的最终区。中文原因和核实事项同样是模型输出，不是授权或执行指令。

## 失败、取消与恢复

config/listing-generation.json 管理输入/响应字节预算、输出 token 预算、超时和提示词版本；它是内部运行策略，不是平台文案限制。响应体流式累计字节，超限停止读取；mock 输出也检查预算。取消/超时中止 signal，并在 mock 忽略 signal 时也结束等待。每次调用仅一次生成，不自动重试格式错误、超时或未知结果，不投递消息、不导出文件、不记录异常正文或凭证。返回稳定失败码，宿主恢复机制在模块 10 接入。

当前内部超时预算为 240 秒，reasoningEffort 为 low。推理预算经统一接口传递，独立于当前对话 Agent 配置。参数依据为 [OpenAI Responses API 文档](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)；具体模型/代理兼容性仍以真实调用验证为准。结果另存策略 SHA-256，配置变化不会只靠版本名追踪。

成功元数据含任务、事实、规划、规则、提示词/策略、实际模型、响应 ID 和文案版本，可用于后续日志与修订。完整请求/响应没有直接写入日志。API 凭证只由宿主拥有；其他业务凭据不会被注入生成请求。

## 测试与样例

运行 `npm test -- tests/listing-generation.test.ts tests/structured-model.test.ts` 和 `npm run build`。覆盖 mock、预算、无工具请求/输出、格式错误、引用错误、跨场景拒绝、并发修改、已取消、进行中取消、超时、不自动重试、错误脱敏和页面保守优化。

构建后运行 `node scripts/listing-generation-sample.mjs`，生成 examples/listing/generation-sample.json。样例是固定 mock、虚构 ExampleBrand 摄像头，不适合发布。mock 含五条文案，并明确存储卡另购、订阅付费和安装供电条件。

`node scripts/listing-generation-smoke.mjs` 在现有网关容器的独立临时目录运行新代码，使用宿主已有模型配置与虚构资料。它不部署/重启服务、不访问 DWS、不读取真实公司资料、不发送消息；结果保存至 output/listing/generation-smoke.json。运行结束删除该脚本创建的临时目录。这是模型接口集成验证，不是完整钉钉端到端验收。

模块 7 的纯代码校验已实现，见 `docs/listing-module-7.md`。模块 8–10 尚未实现；Listing 动态工具、完整状态恢复和最终文件交付将在后续模块接入。

## 本次验收记录（2026-09-30）

- 新增两份测试文件、47 项测试通过；全量 45 个测试文件、455 项测试通过；TypeScript 构建通过。
- 固定 mock 生成样例通过，保存标题、五点、描述、搜索词及逐字段出处、中文说明。
- 真实模型第一次在 120 秒预算下超时，失败记录保存在 output/listing/generation-smoke-timeout.json。没有自动重试、输出半成品或记录凭证。
- 调整为 240 秒、low 推理预算后单独复测，实际模型 gpt-6.1-sol 成功返回五点以及其他字段，结构与引用检查通过；来源仍为虚构产品。报告在 output/listing/generation-smoke.json。
- 真实稿保留不支持 5 GHz、存储卡另购、云存储付费及包装排除项，后台搜索词留空。检查状态仍为 not_run，不以肉眼抽查替代模块 7 的纯代码校验。
- 仅验证本次模型调用和结构化生成，没有验证完整钉钉对话流程、最终文案合规性、真实商品表现或文件投递。
