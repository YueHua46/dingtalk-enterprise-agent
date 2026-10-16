# 德国站广告 PDF 任务耗时与交付失败调查 / 另一 AI 交接材料

调查日期：2026-10-16。证据快照截至 17:58（Asia/Taipei，UTC+8）。

本报告只读调查截图中的任务，不是对整份广告报告真实性的完整复核。没有修改 Agent 源码、业务数据、任务状态或配置，没有取消任务、恢复任务、重启服务或重新部署。报告不包含凭据、用户私聊全文或访问令牌。

## 1. 仓库、运行环境和任务定位

| 项目 | 已确认位置 / 标识 |
| --- | --- |
| 需要另一 AI 排查的 Agent 仓库 | `C:\Users\DIANCHEN\Documents\projects\dingtalk-enterprise-agent` |
| Agent Git origin | `https://github.com/YueHua46/dingtalk-enterprise-agent.git` |
| 当前 HEAD | `e33ec9af9dbebe915ecd22c49680e3196748b186` |
| 工作区状态 | 存在多处未提交改动；不得 reset、checkout 覆盖或清理这些改动 |
| 当前 Agent 生产运行位置 | 本机 Docker；此次证据通过本机 `docker exec` 读取，不能误认为 Agent 运行在 SSH 服务器 |
| Agent 容器 | `dingtalk-enterprise-agent-gateway-1` |
| 文件工作容器 | `dingtalk-enterprise-agent-file-worker-1` |
| Agent 数据库容器 | `dingtalk-enterprise-agent-postgres-1`，数据库 `agent` |
| 此次 Agent 容器启动时间 | `2026-10-16T09:25:17.081937381Z`，即北京时间 / 台北时间 17:25:17 |
| 此次运行的 Agent 镜像 ID | `sha256:022d247fc9dfd3a997b78f3ede34f6c7082238de2b6b078c04e55afec878b7d1` |
| 相关 OPS 仓库，另一条并行工作 | SSH `jennov@192.168.3.75` 上 `/home/jennov/projects/crossborderops-platform` |
| OPS 与本任务的关系 | Agent 使用 OPS 业务数据接口；主 Agent 正在实现 OPS 的 EU ASIN 广告筛选。该工作不要覆盖、打断或混入本次 Agent 修复 |
| 本次完整任务 ID | `fc66b70f-002c-4894-a2bd-1000790cd44e` |

截图任务请求的必要识别信息：德国站、ASIN `B0CWNVMY3J`、2026-10-01 至 2026-10-14，要求广告诊断、Campaign 预算调整、关键词竞价调整、搜索词否定判断，以及 PDF。截图中的机器人时间 17:28 与数据库任务创建时间吻合。

不得恢复或重新执行之前已取消的任务：

- `fe00e88c-b69c-4e4a-a2db-a869bcf79ddf`
- `c10011c4-3702-4bd7-9d7f-887e92103563`

## 2. 结论：24 分钟花在哪里，最后到底是否成功

本任务 **17:28:34 启动，17:52:55 结束，共约 24 分 20 秒**。调查时已不再运行。

它不是因为某次领星取数持续等待 20 分钟，也不是因为计划步骤反复补验。初始数据获取和计算约在 17:31:53 完成，之后仍有本地表格计算及修订。主要过程是模型编写和返工 PDF、反复内容审核，最后审核服务超时。

数据库 `tasks.status = completed`，但 `task_workflows.state.completion.status = partial`，缺口含 `independent_verification`。这两个状态表示不同层面的结束，不应将任务结束解释为 PDF 完整交付成功。

`task_artifacts` 中本任务记录数量为 **0**。没有 `artifact.submitted` 成功事件，PDF 没有发送。最终返回的是带“独立核验未完成”前缀的文字草稿，不是审核通过的 PDF。

审核确实抓到了严重问题，不能通过关闭审核来提速：

- PDF 没有用户要求的预算、竞价和否词具体清单，只有概述；文字摘要又声称已经包含或完整列出。
- 搜索词表现表混入了 `customer_search_term = null` 的配置投放词。
- 将 `keyword_text` 的指标当成客户实际搜索词 `customer_search_term` 的指标，进而提出否定建议。
- 没有成本等前提，却直接断言“整体正向盈利”。

## 3. 时间线（2026-10-16，UTC+8）

| 时间 | 已记录事件 | 意义 |
| --- | --- | --- |
| 17:28:33.682 | 创建任务 | `tasks.created_at` |
| 17:28:34.874 | 开始执行 | `tasks.started_at` |
| 17:29:10 | 第一次 `agent.workflow` 计划调用失败 | 模型修正参数后继续，不是长时间阻塞 |
| 17:29:19 | 计划建立成功 | `workflow.plan` |
| 17:29:23—17:30:42 | OPS 数据、领星接口探测等 | 有几次参数错误，但每次很快返回 |
| 17:31:15 | 产品知识查询完成 | 非业务指标取数等待 |
| 17:31:35 | Amazon 产品信息查询完成 | 耗时约 4.6 秒 |
| 17:31:45、17:31:53 | 两次 Python 计算完成 | 初始取数计算已基本完成 |
| 17:32:26—17:32:41 | 计划步骤核验 | `workflow.step_verification` 为 `pass/satisfied`，约 15 秒；没有反复步骤核验循环 |
| 17:33:29—17:34:21 | 初次文档生成及若干局部修改失败 | 事实绑定、JSON pointer、字段名等错误 |
| 17:34:28 | 第一次编译成功，2 页 | 预算、竞价、否词仍为概括性 summary 块 |
| 17:34:38 | 编译成功，3 页 | 增加活动表格 |
| 17:35:14 | 第一次提交失败 | `OUTPUT_PATH_INVALID`，几百毫秒即返回 |
| 17:35:22—17:36:21 | 第 1 轮内容审核 | `revise`，缺核心清单、回复与 PDF 不符、盈利断言前提不足 |
| 17:37:47—17:39:43 | 表格整理、事实绑定修正、重编译 | 6 页版本，但行动部分仍是 summary |
| 17:39:49—17:41:08 | 第 2 轮内容审核 | `revise`，清单仍未补齐，搜索词表前 9 行搜索词为空 |
| 17:41:31 | 一次本地表格计算失败 | 非接口持续等待；随后重算成功 |
| 17:42:55 | 本地表格计算成功 | 继续改写文档 |
| 17:43:27 | 再次编译成功，6 页 | 具体建议仍主要在 finalAnswer，不在 PDF |
| 17:44:06—17:45:11 | 第 3 轮内容审核 | `revise`，PDF 核心清单仍缺失，并发现投放词 / 搜索词与指标混用 |
| 17:46:51 | 编译成功，8 页 | 预算、竞价、否词改为 `actions` 块；仅证明内容结构变了，不代表已通过核验 |
| 17:47:25—17:49:52 | 第 4 轮内容审核 | `unavailable`；约 146 秒后超时，未得出内容合格结论 |
| 17:50:19 | 重复提交相同文件 | 被不可用审核结果缓存快速拦截，没有重新发起完整审核 |
| 17:50:47 | 试图完成任务 | 因 PDF 未交付，被 `DOCUMENT_NOT_DELIVERED` 拒绝 |
| 17:51:43 | 再次完成调用 | 结构声明不完整，被 `WORKFLOW_MISSING_FACT_UNDECLARED:overall_ad_metrics` 拒绝 |
| 17:52:26—17:52:27 | 最后完成调用 | 累计核验预算已用完，工作流接受 `partial` |
| 17:52:55.181 | 任务记录结束 | `tasks.finished_at` |
| 17:52:57 | 审计记录 `task.completed` | 与结束时间有约 2 秒审计 / 发送过程差异 |

共记录 **41 次工具开始调用，18 次工具调用以 failed 返回**。工具失败包含参数校验、事实绑定、内容审核拒绝等，不代表 18 次外部接口故障。

## 4. 四轮 PDF 审核的具体证据

下列为 `audit_events` 中 `artifact.review` 的必要脱敏摘要。时间与耗时均来自已落库记录；字符数为审核请求 `requestChars`。

| 轮次 | 结束时间 | 状态 | 该轮审核耗时 | 输入字符数 | 输入 token（接口返回） |
| --- | --- | --- | --- | --- | --- |
| 1 | 17:36:21 | revise | 57,167 ms | 183,067 | 63,873 |
| 2 | 17:41:08 | revise | 78,102 ms | 258,586 | 85,901 |
| 3 | 17:45:11 | revise | 64,117 ms | 289,292 | 98,596 |
| 4 | 17:49:52 | unavailable | 146,432 ms | 323,498 | 未取得完整响应 |

以上审核耗时不含模型读取反馈、重新编写和两轮之间的所有工作时间。累计任务审核预算还包括计划步骤等语义审核，因此不能把这四项之和当作唯一累计支出。

### 第 1 轮：真正缺内容，且断言过强

审核问题短引：

> 当前 PDF 与回复中仅给出了泛化的策略说明，未列出具体的活动、关键词及搜索词明细。

> “整体正向盈利”断言缺乏必要前提。

PDF 的行动部分只有概括段落，却声称报告包含具体清单；仅有广告支出和归因销售额，缺采购、平台佣金、FBA 等成本，无法据此直接断言实际经营盈利。

### 第 2 轮：没有按反馈补 PDF，搜索词表选错对象

审核指出：PDF 写“见聊天正文清单”，但提交的最终文本又只有简短总结，并无具体清单。另一方面，所谓客户搜索词表现表的前 9 行 `customer_search_term` 都是 null，实际展示的是配置投放词。

这意味着不是审核只看简短摘要而忽略 PDF；此次审核实际同时检查 PDF 正文与 finalAnswer，并识别出两者都没有所需明细。

### 第 3 轮：详细建议放在聊天中，PDF 依旧缺失；数据维度错用

审核问题短引：

> 第二部分、第三部分、第四部分仅包含几句概括性摘要。

> 将配置投放词（keyword_text）与客户实际搜索词（customer_search_term）混淆。

具体反例：某一词的投放词指标为花费 €14.70、7 次点击、曝光 667；该词在客户搜索词报表中的指标为花费 €6.30、3 次点击。报告曾拿前者作为客户搜索词否定依据。另有仅在配置投放词报表出现的对象被直接列入客户搜索词否定清单。

这些是会影响运营决策的事实问题，不是格式偏好。未对所有后续草稿逐项复算，不能断言最终 8 页版本已全部修复。

### 第 4 轮：请求超时，不能把 unavailable 当成通过

这一轮的安全诊断：

```json
{
  "status": "unavailable",
  "durationMs": 146432,
  "requestChars": 323498,
  "model": "gemini-3.8-flash-high",
  "attempts": 2,
  "requests": [
    {"attempt": 1, "status": 200, "headersMs": 87209, "durationMs": 146269, "error": "TimeoutError"},
    {"attempt": 2, "durationMs": 3, "error": "AbortError"}
  ]
}
```

HTTP 200 只表示拿到了响应头；完整响应未完成。第二次尝试已几乎没有剩余时间，3 ms 内中止。工作流最终保存的累计 `reviewBudget.spentMs = 360000`。不可用原因保存为 `MODEL_REQUEST_RETRY_EXHAUSTED`。

这一轮审核对应的最后 PDF 哈希：

`d7be970aef56679ec76dbe1de353dfd7c557bd834a389f0b72d6859024f27f3c`

该草稿已编译，但没有成功发送。不能为绕过核验直接发送这份文件。

## 5. 其他失败与准确边界

初期接口和文档失败的短错误：

```text
CROSSBORDEROPS_DATA_HTTP_400: sp_search_terms 的 asins 筛选无效或不受支持
CROSSBORDEROPS_DATA_HTTP_400: ads.sp_search_terms 不支持参数 campaign_ids；筛选不会被静默忽略
LINGXING_UNSUPPORTED_PARAM: reason
DOCUMENT_LITERAL_FACT_REQUIRES_BINDING
FACT_BINDING_INVALID / FACT_FIELD_UNAVAILABLE
Invalid string: must start with "/document/"
FILE_WORKER_400: {"error":"OUTPUT_PATH_INVALID"}
ARTIFACT_REVIEW_UNAVAILABLE: 文件尚未发送，核验未完成：MODEL_REQUEST_RETRY_EXHAUSTED
```

这些说明模型有数次不按接口/schema 调用，以及不完整地处理文档反馈。接口拒绝不支持的筛选比静默忽略更安全，不能通过忽略参数来“修复”。

初始事实绑定失败中包含正文的 ASIN、日期、观测数值等未绑定内容；工具错误已经明确要求绑定事实或将用户指定日期放在 subtitle / metadata。之后一次行动块 evidence 数值未绑定也被阻止。应提升模型按结构输出的成功率，不能以删掉关键事实、只保留空泛摘要来绕过绑定。

最终聊天草稿约 6,571 个字符（工作流 completion.answer），包含详细调整建议；这里只记录长度，不复制用户私聊全文。它被宿主加上未核验前缀后返回，未获得最后独立核验结果，因此不应当作已完成验证的运营操作清单。

## 6. 相关源码定位（当前本地工作树，行号可能随编辑变化）

| 文件 / 行 | 作用与调查联系 |
| --- | --- |
| `src/task-orchestrator.ts:1432` | 任务执行结束更新 `tasks` 为 completed；需结合工作流 completion.status 看业务交付结果 |
| `src/task-orchestrator.ts:1462` | 写入 `task.completed` 审计事件 |
| `src/task-orchestrator.ts:1704` | 联合构造 `artifactBody`、`actualPdfText`、`finalAnswer` 审核输入；存在多种表达同时进入请求，须验证是否重复过多 |
| `src/task-orchestrator.ts:1720` | 保存每轮 `artifact.review` 状态、耗时与诊断 |
| `src/task-orchestrator.ts:2398` | `reviewWithinTaskBudget`，累计并持久化语义审核时间 |
| `src/task-orchestrator.ts:2407` | 用总预算减已花费时间，约束本轮 deadline |
| `src/task-orchestrator.ts:2424` | `submitCompletion`，统一完成任务及审核入口 |
| `src/task-orchestrator.ts:2564` | 审核 unavailable 时，改为 partial 并为原 answer 加前缀；当前会把整份未核验长草稿作为结果返回 |
| `src/evidence-reviewer.ts:121` | 模型审核重试预算 |
| `src/evidence-reviewer.ts:182` | 模型请求预算与超时配置进入请求重试层 |
| `src/evidence-reviewer.ts:245` | `buildPayload`，审核上下文与证据构建 |
| `src/evidence-reviewer.ts:316` | 在完整 completion 之外附加 `documentReviewUnits` |
| `src/evidence-reviewer.ts:338` | `documentReviewUnits`，逐个文本 / 行动字段及 finalAnswer 建立检查单元 |
| `src/evidence-reviewer.ts:376` | `compactVerifiedFacts`，已有事实上下文去重，优化前先分析现有逻辑，避免重复实现或丢失查询/维度信息 |
| `src/config.ts:52` | 单次审核超时默认 180,000 ms |
| `src/config.ts:54` | 审核请求重试预算默认 360,000 ms |
| `src/config.ts:55` | 任务累计审核预算默认 360,000 ms；本任务实际用尽 360,000 ms |
| `src/document-grounding.ts:39` | 正文观测数字事实绑定约束 |
| `src/document-grounding.ts:80` | 针对数值、真实对象身份和局部修正的反馈说明 |
| `src/document-render.ts:100` | 各 block 类型字段契约，具体行动应使用 actions 等合适结构 |
| `src/document-render.ts:104` | 对象原名保护、事实与建议值分开、预算和 CPC 不等于配置出价等规则 |

这些行号来自当前未提交工作树，不能仅以 HEAD 推定部署时的全部源码内容。若需要修复，应先确认当前代码、运行镜像及已有改动的差异。

## 7. 已证实与仍待验证

### 已证实

1. 任务结束，不是仍卡在“正在整理回答”；数据库状态和工作流状态存在表达层次差异。
2. PDF 没有交付，最后是 partial 文本草稿。
3. 唯一一次步骤语义核验约 15 秒，并非耗时主因。
4. 三轮内容审核发现实质缺失或事实维度错误，模型返工后才把概述块替换为具体行动块。
5. 审核请求从约 18.3 万字符增加到 32.35 万字符，最后一次超时且累计预算用尽。
6. 相同文件在审核 unavailable 后重复提交被缓存快速拦截，没有无休止重发审核请求。

### 待验证，不应写成已确定的根因

1. 输入增长中分别有多少来自 artifactBody、实际 PDF 提取文本、finalAnswer、reviewUnits、完整事实清单、证据上下文和反馈。源码可见潜在重复，但还没做按字段字节 / token 归因。
2. 最后一轮超时是否主要由请求体大小、上游排队、模型生成检查单元过多或网络问题导致。当前诊断仅能证明 87 秒才拿到响应头、总约 146 秒后超时，不能锁定单一原因。
3. 模型为什么连续三次没有把详细行动写入 PDF：可能是接口复杂度、先前错误后过度简化、指令执行不稳定等，需要重放脱敏样例验证。
4. 8 页版本是否已完全修复维度错用、出价和 CPC 概念混淆、过强盈利/未来收益预测；最后审核未完成，不能预先认定合格。
5. 最终的任务卡是否清楚显示“部分完成 / PDF 未发送”，以及是否在中途给了可理解的进度。此次未直接读取用户钉钉 UI，不对实际卡片文案作未经验证的断言。

## 8. 建议修复方向与验收

按以下顺序处理，保留事实核验和真实数据，不做模板化硬套业务结论。

1. **让第一次 PDF 就承载用户所需的完整行动明细。** 区分 summary 与 actions：预算、关键词竞价、客户搜索词否定建议应进入真实 PDF 内容块，不能写“见聊天清单”来代替。数字观测绑定证据，建议值独立表述；缺实际预算 / 配置竞价则明确未知，不把日均花费 / 实际 CPC 冒充当前配置。
2. **根据同一份结构化内容生成详细 PDF 与短聊天摘要。** 摘要只在文件成功交付后声明“已发送”。不要让模型独立编写两套详细清单而相互矛盾。
3. **衡量审核输入的重复量，再去重。** 对各一级字段记录长度等安全元数据；保留统计口径、店铺、日期、ASIN、报表、真实对象身份、行维度与血缘。可以共享引用或把同一正文只传一次，不能粗暴截断关键证据，也不能只审短摘要放过 PDF。
4. **提高局部修复的完成度。** 审核发现多个必须修正项后，应检查实际文档是否补齐对应块，减少“改了聊天、没改 PDF”的返工。不能用自动捏造观测值、改运营数据或关闭质量门槛来通过。
5. **明确审核不可用的收尾行为。** PDF 未通过 / 未发出时，只返回短状态、已完成项、缺口与下一步；默认不要把未核验的 6,000 多字符详细建议全部倾倒给运营。若产品决定允许显式查看草稿，也需清楚区分草稿与已验证可执行结果。
6. **显示交付层面的 partial 状态。** 任务生命周期结束可以保留 completed，但用户可见卡片、后台状态应同时展示业务结果 partial 和 PDF 未发送，不能让运营误认为成功。
7. **用真实失败模式做回归测试。** 包括：搜索词空值、keyword 与 search_term 同字但不同指标、预算/配置竞价缺失、缺成本不可断言盈利、PDF 与摘要一致、审核超时后 partial 短回复、重复提交不重复审核、取消后不再启动工具。

不能把延长总等待时间、移除审核、把模型建议当事实、把不同报表的数据凑齐作为解决方案。可调整超时预算，但必须有输入体积和端到端耗时证据支持，且给用户明确可预期的结束行为。

## 9. 可直接复制给另一个 AI 的提示词

```text
请在以下仓库排查并提出/实施“广告 PDF 交付耗时和审核返工”的修复；开始前先阅读 AGENTS.md 与下列调查报告：

仓库：C:\Users\DIANCHEN\Documents\projects\dingtalk-enterprise-agent
Git origin：https://github.com/YueHua46/dingtalk-enterprise-agent.git
报告：C:\Users\DIANCHEN\Documents\projects\dingtalk-enterprise-agent\.tmp\pdf-review-investigation-2026-10-16.md

重要工作边界：
- 当前本地工作区已有很多未提交改动，必须保留；不得 reset、覆盖或清理他人改动。
- 另外一个 Agent 正在 SSH jennov@192.168.3.75 的 /home/jennov/projects/crossborderops-platform 实现 OPS 欧洲站 ASIN 筛选，请不要修改那个仓库、不要部署或重启 OPS、不要改它的同步计划。
- Agent 实际运行于本机 Docker，不要误认为在上述 SSH 服务器。
- 本提示词是修复工作交接。先核对用户在新会话授权的范围；如仅让你分析，就只读调查。生产重启/部署须服从用户在新会话给你的范围，不要将本报告当作已授权重启。
- 不修改运营真实数据、不使用管理员冒充用户、不跳过数据权限、不在输出中泄露凭据或私聊全文。
- 不恢复/重跑已取消任务 fe00e88c-b69c-4e4a-a2db-a869bcf79ddf 和 c10011c4-3702-4bd7-9d7f-887e92103563，也不要擅自重跑此次任务。

待解决的真实问题：
任务 fc66b70f-002c-4894-a2bd-1000790cd44e 在 2026-10-16 17:28:34 到 17:52:55（UTC+8）运行约 24 分 20 秒。用户要德国站广告分析与 PDF。初始取数约 17:31 已完成；唯一一次计划步骤核验只约 15 秒。前三轮 PDF 审核真实发现：PDF 缺预算/关键词/否词具体清单，模型多次只改聊天摘要；搜索词表选了 customer_search_term=null 的配置词；把 keyword_text 指标错当 customer_search_term 指标；缺成本却断言盈利。17:46 才生成 8 页行动块版本，第 4 轮审核输入达 323,498 字符，146 秒超时，累计审核预算 360 秒耗尽。最后任务生命周期 completed、业务结果 partial、0 个已交付文件，给运营发了很长的未核验文字草稿。

请优先检查：
1. src/task-orchestrator.ts 的 artifact.submit 联合审核、reviewWithinTaskBudget、submitCompletion 的 unavailable/partial 收尾与状态表达。
2. src/evidence-reviewer.ts 的 buildPayload、documentReviewUnits、compactVerifiedFacts：按字段统计输入大小，验证 artifactBody、actualPdfText、finalAnswer、reviewUnits、facts 和证据上下文是否重复；去重必须保留完整统计维度和证据，不得只核验摘要或粗暴删证据。
3. src/document-render.ts、src/document-grounding.ts 与相关 guide/schema：让模型第一次就把用户要求的完整明细写到 PDF 的 actions/table 等正确内容块中；观测值绑定，建议值单列，真实对象名保留。不能靠删掉具体事实、用概括替代交付来绕过保护。
4. 关键词、投放目标、客户搜索词三种维度要分清；当前配置出价不等于历史实际 CPC，日预算不等于日均花费；缺成本时不声称已盈利。
5. PDF 未交付/审核不可用时给短而明确的部分完成反馈，避免自动把长篇未核验建议当可执行结果发出；卡片/后台不能只显示 completed 让人误判。

保留现有保护：事实与对象身份绑定、PDF 和摘要联合核验、重复提交缓存、审核预算上限、取消后禁止新工具、当前用户身份和原会话发送约束。不能通过关核验、伪造数据、增大等待时间来掩盖问题。

请区分已证实根因与待验证假设。用针对性的脱敏回归测试覆盖上述真实失败模式，报告具体改动、验证和剩余限制。若需要部署，先完成代码和测试，再严格按我在此新会话授权的范围执行；不要干扰并行的 OPS 工作。
```

## 10. 证据复核入口（只读）

主要证据表为 `tasks`、`task_workflows`、`audit_events`、`task_artifacts`。查询应始终限定上述完整任务 ID，避免输出其他用户内容。以下是可用的最小 SQL，不包括凭据或原始私聊：

```sql
SELECT id,status,created_at,started_at,finished_at,error_code
FROM tasks WHERE id='fc66b70f-002c-4894-a2bd-1000790cd44e';

SELECT state#>>'{completion,status}' AS completion_status,
       state#>>'{completion,missingFacts}' AS missing_facts,
       state->'reviewBudget' AS review_budget
FROM task_workflows WHERE task_id='fc66b70f-002c-4894-a2bd-1000790cd44e';

SELECT created_at,event_type,payload->>'status' AS review_status,
       payload->>'durationMs' AS duration_ms,
       payload#>>'{diagnostics,requestChars}' AS request_chars
FROM audit_events
WHERE task_id='fc66b70f-002c-4894-a2bd-1000790cd44e'
  AND event_type IN ('artifact.review','workflow.step_verification','workflow.review_unavailable','workflow.complete','task.completed')
ORDER BY created_at,id;

SELECT count(*) AS delivered_artifact_count FROM task_artifacts
WHERE task_id='fc66b70f-002c-4894-a2bd-1000790cd44e';
```

本报告未执行修复测试或部署，不能把调查完成当作问题已修复。
