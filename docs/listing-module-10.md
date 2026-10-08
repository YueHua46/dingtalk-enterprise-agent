# Listing 模块 10：完整接入与评估

## 运行入口

`skills/amazon-listing-studio/SKILL.md` 指导对话，宿主注册 `listing.prepare/research/generate/inspect/revise/export`。生产环境使用 PostgreSQL 保存输入快照和不可变文案版本；每次调用按当前 corpId、userId、原会话及 sessionId 隔离。没有审批状态或后台上传工具。

运营可以说“根据这些产品参数生成美国站英文 Listing，并给我 Word 和 Excel”，附文字或附件；优化时提供本品 ASIN。宿主将对话材料绑定真实消息原文，丢弃无法从原文证明的模型提取候选。文档和附件在使用时重新核验当前用户读取权限。只有 ASIN 时，原页面声明标为未经独立核实；提供本品资料时不以页面声明扩充本品能力。

调研按固定接口执行，原始市场文本存储为证据，动态工具只返回统计、候选 ASIN 和缺口；评论不会返回有工具权限的主 Agent。生成模型经统一结构化接口调用，没有业务工具。模型输出依次排列的文本片段及事实 ID，代码用一个空格拼接并计算准确字符位置，避免让模型重复全文或计算索引；引用无效或重叠均拒绝。兼容旧片段格式时，不存在或无法唯一定位的短语仍拒绝。数字、属性、限定条件与受控表达检查不变，校验器不调用模型。模型传输使用有界 SSE，只接受完整 completed 响应，不使用部分输出，拒绝工具调用事件。

inspect 和 generate 返回精简文案版本，不回传包含市场原文的生成上下文。相同生成任务重复调用返回已有版本；研究在生成后冻结。修订以版本和宿主请求 ID 保证幂等，每次重新校验。导出重新加载规则，复用文件服务、病毒扫描和原会话投递；未知投递结果不自动重发。

## 自动回归

```powershell
npm run build
npm test
npm run eval:listing
```

固定 mock 评估在 `eval/listing/cases.json`，结果写入 `output/listing/eval/results.json`。覆盖正常但规则待核实、虚构分辨率、无效出处、无依据卖点、工具注入和损坏 JSON。输出校验通过率、事实性声明出处覆盖率、需补资料或判断的任务比例、生成失败数及每例预期状态。

这些指标包含刻意构造的负例，不代表真实模型的质量评分。失败生成不计校验通过；无事实性声明覆盖率为 null。对于能解析但出处错误的负例，另做纯代码诊断以检验拒绝行为，不能交付为成功生成。

真实钉钉测试脚本 `scripts/listing-dingtalk-e2e.mjs` 要求显式当前用户 profile、已核实群 ID、机器人 ID 和提示文件，发送真实个人消息并观察原群 Word/Excel，不通过内部接口注入任务。运行前必须 readyz 成功；消息投递成功和机器人实际执行分别判定。测试证据在 `output/listing/e2e`，不保存凭证及临时签名资源 URL。

## 部署

两个宿主镜像需包含 `config/`，数据库应用 `013_listing_tool_sessions.sql` 和 `014_listing_session_snapshots.sql`。会话同时保存可查询 JSONB 和原始序列化文本，完整性校验使用文本快照，避免 JSONB 重排字段造成误拒绝。旧的 JSONB-only 开发测试会话不能证明原始序列化，显式要求重新准备任务，不静默替换证据。既有修订表迁移为 `012_listing_revisions.sql`。完整项目的知识模块要求 PostgreSQL pgvector，保留原数据卷；Listing 自身不使用向量检索。

验收期间发现并修复 Hybrid 文件客户端未转发 Listing 渲染、模型重写源文本、模型计算字符位置、旧事实快照兼容性等集成问题。最终真实验收记录单独保留，不能用模拟文件测试替代原群收件测试。

## 完成验收

见 [2026-10-01 真实验收记录](listing-e2e-2026-10-01.md)。最终 build、616项单元测试、11项独立文件测试和六例固定评估回归通过。实际公司产品完成原群 Word/Excel 交付与修订，下载文件和宿主哈希/内容一致。第4版硬检查通过、19/19声明有出处，平台规则及部分表达仍待核实，未宣称全面平台合规。

额外数据库与收件检查：`node scripts/listing-session-pg-smoke.mjs` 在事务内的临时表运行；`scripts/listing-capture-e2e-payload.mjs` 只读已知任务快照；`scripts/listing-verify-files.py` 检查实际下载的文件。单点修订可使用 `bullets.0` 至 `bullets.4`，宿主保留未选择字段，避免修改一条五点时连带重写其他字段。
