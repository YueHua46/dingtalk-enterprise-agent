# 部署与运行手册

## 1. 上线前检查

1. 钉钉企业内部应用已启用机器人 Stream 模式。
2. 应用只申请实际需要的文档、知识库、钉盘、日历、待办、通讯录、群聊、OA、邮件、听记等权限。
3. 模型中转支持 Responses API，并已准备 Base URL、API Key 和模型名。
4. `.env` 已配置钉钉、模型、Bot Profile 与不少于 32 字节的 `INTERNAL_API_TOKEN`。
5. `.env` 未进入版本控制，部署目录和 Docker Volume 仅允许运维账号访问。
6. 服务器时间同步正常；审批过期、审计时间和 OAuth 依赖准确时间。

## 2. 权限矩阵

| 行为 | 执行身份 | 是否确认 | 结果去向 |
|---|---|---|---|
| 搜索、读取、汇总 | 当前聊天员工 Profile | 否 | 原会话；个人内容优先私聊 |
| 创建、更新、发送、完成待办 | 当前聊天员工 Profile | 本人确认一次 | 原会话 |
| 删除、审批、权限、批量、财务类操作 | 当前聊天员工 Profile | 本人确认一次，高风险标记 | 原会话并写审计 |
| 机器人状态、授权入口、结果通知 | `DWS_BOT_PROFILE` 或 sessionWebhook | 不代表业务授权 | 原会话或发起人私聊 |
| 长期记忆读取 | 当前 `corpId + userId` | 否 | 当前会话 |
| 长期记忆保存/删除 | 当前 `corpId + userId` | 本人确认一次 | 当前会话 |
| 读取已注册 Skill | `reference.read_guide` 只读工具 | 否 | 不单独发送通知 |
| 领星/SIF 查询、统计、分析、报表与导出 | 共享服务密钥，只读 | 否 | 原会话；敏感业务结果优先私聊 |
| 领星新增、修改、删除及其他状态变更 | 共享服务密钥 | 当前发起人确认一次 | 原会话并写审计；幂等保护 |
| 默认 gateway Codex shell 提权、访问其他目录 | 不允许通过业务确认放行 | 否，直接拒绝并审计 | Agent 继续尝试已注册工具或报告限制 |
| 文件容器内 shell 和任务文件 | 每任务独立 Linux UID 与工作目录 | 任务内文件编辑不需业务确认 | 成果经宿主校验后发回原会话；钉盘原位覆盖仍需确认 |

禁止使用管理员 Token 替员工访问资源。钉钉服务端是最终权限裁决者；网关同时强制 Profile 身份匹配和 DWS 能力白名单。
Codex 的业务写入必须经过结构化动态工具，不能把通用 shell 审批当作业务授权。仅模型连接凭证会传给 Codex 子进程；部署时应给模型中转密钥设置独立限额。
当前 Docker Desktop 容器无法建立 bubblewrap 用户命名空间，故原生 shell 工具已关闭。若以后需要通用 shell，应先在独立隔离容器中验证实际沙盒、凭证隔离和写入策略，不得直接通过用户的钉钉确认放行。

领星官方 MCP 的 `help`/`search` 仅作为原生目录工具接入。共享密钥的通用 `action` 无法证明请求参数和返回结果均按当前钉钉用户的店铺范围裁剪，现已从 Agent 动态工具列表撤下，宿主收到旧会话的调用也会拒绝。自有店铺数据经 CrossBorderOps 服务端按 SID 查询。SIF 当前未提供 MCP `readOnlyHint`，因此仅允许经过核验的只读工具白名单；远端新增工具默认不可用。

权限边界：CrossBorderOps 路径用于公司自有店铺经营数据，必须按当前钉钉用户的有效店铺映射裁剪；后台授权查询会在通讯录缓存超过 15 分钟时自动刷新，刷新失败则拒绝查询。SIF 路径用于公开 ASIN、关键词和竞品数据，只要 SIF 工具本身支持该查询即可按 ASIN/关键词直接查询，不经过 CrossBorderOps 店铺授权门禁。两类数据在回答中必须标明来源，不能把 SIF 公开结果当作内部店铺数据。

### Amazon 与紫鸟 Skills

项目发布 Nexscope 的 53 个 Amazon 子 Skill、`zach22-1999/amazon-skills` 的 7 个 Skill，以及基于 `awesome-amazon-ec-skills` 的只读社区目录 Skill。Awesome 仓库只是第三方项目索引，不会递归自动安装其中链接的所有代码。部分 Zach Skill 依赖 Sorftime MCP 或 Python 脚本；未配置对应运行能力时，只使用其不依赖这些组件的分析流程。

镜像还安装 `@ziniao-open/cli` 并发布 13 个紫鸟 Skill。Codex 通过 `ziniao.cli` 结构化工具调用业务命令。配置 `ZINIAO_REMOTE_HOST` 后，网关通过专用 SSH 密钥连接所选执行机上的强制命令 worker；该密钥不能获得交互 shell、端口转发或 X11 转发。worker 以当前钉钉用户的 `corpId + userId` 哈希选择专属 HOME，不同运营人员不能共享同一个 HOME，也不依赖全局 current profile。未配置远端主机时才使用容器内的 CLI 和 `ziniao-data` 持久卷。

首次真正调用紫鸟工具时，网关先检查该用户目录的有效配置；没有配置时运行 `ziniao-cli config init --new --profile <用户专属标识>`，把授权链接只发给当前发起人私聊，等待授权完成后继续原任务。数据库仅记录非敏感 profile 标识和授权时间，不保存 API Key。确认按**具体操作的业务效果**判定：查询、打开/关闭浏览器中的店铺、登录、切换站点或界面语言、导航、截图无需业务确认；创建/修改/删除商品、订单、店铺配置、成员权限等业务数据，以及效果不明的页面交互或通用调用，进入原会话确认与幂等记录。`page.click`、`page.input` 和 `automation.run` 要附当前步骤的 `purpose`，宿主结合用户原请求、目标元素和自动化每一步判定；调用方自述的目的不能覆盖明显的业务变更目标。店铺和页面命令依赖执行机本机紫鸟客户端的 ZClaw Bridge（127.0.0.1:9481）；客户端登录不等于 Bridge 就绪。2026-09-28 生产 `.env` 已明确指向 Windows 执行机 `192.168.3.111`，gateway 已重建且 Bridge 探测通过。Linux jennov-75 的客户端 6.25.3 虽已登录，但 Bridge 端口未监听。

### Windows 紫鸟生产执行机（192.168.3.111）

Windows 的 `info` 仅是 SSH/紫鸟 CLI 进程运行账号，不是运营人员身份。`remote/ziniao-worker-win.mjs` 以网关提供的 `sha256([corpId,userId])` 选择 `C:\ProgramData\DingtalkZiniao\users\<哈希>` 作为独立 `USERPROFILE`，使用 `dingtalk-<哈希前24位>` 专属 CLI profile。worker 不读取 `C:\Users\info\.ziniao-cli`，也不执行全局 `config use`。各人的授权流程要分别写入各自的加密 API Key 引用；若该目录未授权，直接返回 `ZINIAO_AUTH_REQUIRED`，不能回退使用 Windows 当前登录者的 Key。根目录和 users 目录 ACL 仅允许 SYSTEM、Administrators；网关 SSH 公钥被限制为强制运行 worker，无交互 shell 或端口转发。

这只是 CLI 凭证隔离，不等同于 Windows 系统账号隔离；本机管理员仍是受信任的运维主体。Windows 客户端与 Bridge 已就绪，单个现有紫鸟登录能列出店铺，未授权的隔离目录会被正确拒绝。2026-09-28 按用户明确要求跳过双成员 A/B 验证并切换生产网关；因此**仍不能认定 Bridge 店铺/页面能力已实现按 API Key 的服务端权限隔离**。不要把 Windows GUI 的现有登录视为其他运营人员的授权。授权链接只发对应用户私聊，不收集明文 API Key。

当前生产 `.env` 设置为 `ZINIAO_REMOTE_HOST=192.168.3.111`、`ZINIAO_REMOTE_USER=info`、`ZINIAO_REMOTE_KEY_PATH=/home/agent/.ziniao-cli/ssh/id_windows_ed25519`、`ZINIAO_REMOTE_KNOWN_HOSTS_PATH=/home/agent/.ziniao-cli/ssh/known_hosts_windows`。`docker-compose.yml` 的缺省值仍指向 Linux jennov-75；迁移或恢复部署时须保留这四项配置。

### 紫鸟执行机串行化（Gate 与机器锁）

紫鸟官方只保证多账号切换，不支持多账号同时调用 CLI。因此整个系统按全局串行设计：任一时刻，一台执行机上最多只有一个紫鸟 CLI 进程在运行。该约束由两层共同保证：

1. **网关进程内闸门（`src/ziniao-gate.ts`）**：所有紫鸟工具调用先过闸门，按先来先服务（FIFO）排队。每类操作有自己的时长上限（status 30 秒、run 90 秒、授权 18 分钟，超时强制释放租约并报 `ZINIAO_LEASE_LOST`）。店铺/页面桥接命令（`store`/`page` 命名空间）使用会话租约：同一次任务内连续的桥接命令（如 store open → page screenshot → store close）持有同一租约，不被其他用户插入；任务结束或空闲超过 `ZINIAO_SESSION_IDLE_MS` 后自动释放。排队中的任务可被 `取消 <任务编号>` 取消（报 `ZINIAO_CANCELLED`），等待超过 `ZINIAO_GATE_MAX_WAIT_MS` 报 `ZINIAO_QUEUE_TIMEOUT`，队列满时报 `ZINIAO_BUSY`。
2. **执行机机器锁（`remote/ziniao-worker*.mjs`）**：worker 在真正 spawn CLI 前用 `open('wx')` 独占创建 `cli.lock`，拿不到锁就等待（`ZINIAO_LOCK_WAIT_MS`，默认 10 秒）。这是兜底层：即使网关出现 bug、部署了多副本，或有人手工 SSH 进执行机，物理上也起不了第二个 CLI 进程。锁文件带时间戳，进程崩溃残留的陈旧锁在 `ZINIAO_LOCK_STALE_MS`（默认 20 分钟）后被自动回收；worker 只删除自己 pid 写入的锁。

排队体验：任务等待超过 30 秒时，用户会在钉钉里收到排队位次提示（只显示自己的位次和预计等待，不泄露其他排队者身份）。用户可随时调用 `ziniao.cli` 能力 `utility.queue-status` 查看自己的位次——该能力在网关进程内返回闸门快照，不执行 CLI、不占用执行机、不需要排队。

相关配置（`.env`，均有默认值，一般不需要改）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ZINIAO_GATE_DISABLED` | `false` | `true` 时旁路进程内闸门；仅排查闸门自身故障时临时使用，机器锁仍生效 |
| `ZINIAO_GATE_MAX_WAIT_MS` | 900000（15 分钟） | 单次排队等待上限，超时报 `ZINIAO_QUEUE_TIMEOUT` |
| `ZINIAO_GATE_MAX_WAITERS` | 20 | 队列容量上限，超限直接报 `ZINIAO_BUSY` |
| `ZINIAO_SESSION_IDLE_MS` | 180000（3 分钟） | 桥接会话空闲释放阈值 |
| `ZINIAO_SESSION_MAX_MS` | 1800000（30 分钟） | 会话租约硬上限，超时强制释放并报 `ZINIAO_LEASE_LOST` |
| `ZINIAO_INTERLEAVE_READS` | `false` | 预留项：允许只读短查询穿插会话租约。默认严格全串行；在紫鸟官方书面确认 CLI 可并发前不得开启 |
| `ZINIAO_LOCK_WAIT_MS`（worker 端） | 10000 | worker 等待机器锁时长 |
| `ZINIAO_LOCK_STALE_MS`（worker 端） | 1200000（20 分钟） | 陈旧机器锁自动回收阈值 |

观测：`/metrics` 暴露 `ziniao_gate_queue_depth`（排队深度）、`ziniao_gate_busy`（执行机是否被占用）、`ziniao_gate_holder_held_ms`（当前持有时长）、`ziniao_gate_busy_total`、`ziniao_gate_queue_timeout_total`、`ziniao_gate_cancelled_total`、`ziniao_gate_lease_lost_total`、`ziniao_gate_session_expired_total`。若 `ziniao_gate_busy` 长期为 1 且 `ziniao_gate_holder_held_ms` 持续增长，优先检查执行机上是否有卡死的 CLI 进程，而不是重启网关。

排障要点：

- 执行机锁残留：worker 崩溃可能在执行机留下 `cli.lock`；等待 `ZINIAO_LOCK_STALE_MS` 后会被后续请求自动回收，一般无需人工处理。确需立即恢复时，确认无 CLI 进程运行后由运维手工删除锁文件。
- 同用户自排队：同一次任务内的桥接命令会复用既有会话租约（闸门内做了同用户重入识别），若日志出现同一用户会话互相等待，属于闸门缺陷，请提 issue 并附 `ziniao_gate_*` 指标。
- CLI 输出兼容：`--format` 不是全局参数，不能统一追加到 `store open/close`、`page screenshot`、`zclaw invoke` 等命令。worker 先按退出码判断成功或失败；成功时接受 JSON、普通文本或空输出并归一化返回，避免把已成功的会话命令误报为 `ZINIAO_INVALID_RESPONSE`。
- 闸门与机器锁互不替代：闸门负责公平排队和用户体验，机器锁负责硬性互斥；`ZINIAO_GATE_DISABLED=true` 只关闭前者，不能用于绕过串行约束。

## 3. 首次启动

```powershell
Copy-Item .env.example .env
# 填写 .env，不要把值打印到日志
docker compose up -d postgres redis clamav postgres-backup
docker compose build gateway
docker compose up -d gateway
docker compose ps
```

PostgreSQL、Redis 和 ClamAV 仅发布到 `127.0.0.1`，供本机 Smoke 使用；容器之间通过 Compose 私有网络通信。Gateway 根文件系统只读，Codex SQLite 状态、DWS 凭证、媒体和工作区分别使用独立可写 Volume。

Gateway 每次启动先执行版本化迁移。迁移器使用 PostgreSQL advisory lock 与 `schema_migrations`，多个副本同时启动不会重复执行同一迁移。

## 4. DWS 身份与授权

### Bot Profile

Bot Profile 仅用于机器人身份主动发送 Markdown，不得用作员工业务操作身份。

```powershell
docker compose run --rm --no-deps gateway npm run auth:dws-bot
docker compose run --rm --no-deps gateway dws profile list --format json
docker compose run --rm --no-deps gateway dws auth status --profile <corpId>:<userId> --format json
```

`auth:dws-bot` 会检查 Compose 中的机器人应用配置，但设备授权使用 DWS 托管 OAuth
Client，不会把机器人 AppKey/AppSecret 传给登录端点。机器人凭据可用于 Stream 和机器人
应用接口，却不会自动成为 `login.dingtalk.com` 的设备流客户端；强行传入会返回
`[900103] 应用不存在`。授权成功后，以 `profile list` 的真实返回值填写 Profile Key。

授权配置和 Linux 加密 Keychain 分别保存在 `dws-data` Volume 内的 `/var/lib/dws` 与
`/var/lib/dws/keychain`。设置 `DWS_BOT_PROFILE=<corpId>:<userId>` 后重启 Gateway。

### 员工 Profile

每个新任务在进入附件处理、路由和模型回合前都会检查当前员工的 DWS Profile。尚未授权或 Token 已失效时，任务立即进入 `waiting_oauth`；不能先让模型回答“未授权”，也不能等模型选择某项能力后才启动授权：

1. 网关使用 DWS 托管 OAuth Client 发起 `dws auth login --device`；不得注入机器人 AppKey/AppSecret。首次授权（`profile list` 中无该员工 Profile）**不带 `--profile`**——CLI 对未注册 Profile 会直接报 code 3 `profile not found`；重新授权（Profile 已注册、Token 失效）才带 `--profile <corpId>:<userId>` 绑定既有 Profile。
2. 授权地址与一次性验证码只私聊发起人（钉钉原生机器人单聊接口 `robot/oToMessages`，仅用应用凭证，不依赖 DWS Bot Profile；DWS Bot Profile 仅作降级发送通道）。
3. 授权完成后调用 `dws auth status --profile <corpId>:<userId>`。
4. 返回身份必须与消息的 `corpId + userId` 完全一致，否则拒绝并记录错误。
5. 匹配后恢复原任务；Token 过期时重新进入此流程。

网关不保存或输出 access token、refresh token、设备验证码和 AppSecret。

### Amazon 页面原子工具

Gateway 镜像内置 `vendor/amazon-skill` Python 包，通过宿主动态命名空间 `amazon.*` 暴露七个只读页面工具：`search_products`、`image_search`、`get_product_detail`、`get_related_products`、`get_promotions`、`get_reviews`、`get_keyword_rank`。用 `reference.read_guide` 读取 `amazon-page-research` Skill 的组合方法。与 CrossBorderOps 的内部经营数据分开标注来源；Amazon 页面结果为实时观察，不授予内部店铺权限。

普通页面工具覆盖 BE (`amazon.com.be`)；StyleSnap 以图搜品仅覆盖 US/DE/IT/ES/JP，BE 的 `/shopthelook` 当前返回 404。ASIN 详情成功时宿主尝试从允许的 Amazon 图片域下载第一张主图，校验 MIME、大小和安全扫描后生成当前任务内的 `mainImageAttachmentId`，可传给 `image.generate` 的 `operation=edit`。页面主图下载失败时仍返回已解析的商品字段并明确 `mainImageDownloadError`。评论页跳转登录时退到商品页可见评论，并标记 `source=product_detail_visible_reviews`；排名仅在第一页验证配送邮编后提供位置，否则返回 `unavailable`。

验收：`npm run build`、`npm test`、`python -m unittest discover -s vendor/amazon-skill/tests -v`。真实 Amazon 页面双问法矩阵见 `scripts/amazon-tool-e2e.mjs`，需设置 `AMAZON_E2E_IMAGE` 为任务测试图片路径后运行；模型选工具的双问法矩阵见 `scripts/amazon-agent-e2e.mjs`，依赖可用的模型额度。

### Gemini 原生联网

当前 Sub2API 账号使用 Antigravity OAuth 路由。Google Search 内建工具与自定义函数工具的混用支持取决于模型、协议及中转版本；2026-10-14 的实际 Responses 混用探测已返回 HTTP 200，不能将 400 概括为所有请求都不支持混用。为兼容不同路由，网关将 `internet.search` 作为 Codex 动态工具始终提供给模型：是否调用完全由模型决定，不做关键词分流；实际查询由单独的 Gemini Responses 请求携带 `tools: [{"type":"web_search"}]` 执行，并要求返回 grounding 来源后才算成功。它是同一 Agent 任务中的模型决策工具调用，**不是**同一个 Gemini 请求里同时声明 Google Search 和钉钉函数。

当前 Sub2API Antigravity Responses 桥还会丢失 Codex 命名空间子工具名。启用 `MODEL_TOOL_COMPAT_PROXY=true` 后，网关对所有命名空间工具统一执行可逆名称映射（例如 `dingtalk.dws` ↔ `dingtalk__dws`），只处理协议字段，不读取消息内容或按关键词决定工具。模型中转恢复可用后运行 `docker compose exec -T gateway npm run test:codex-native-web` 做真实联网验收；检查模型确实调用了工具、Gemini 返回 grounding、最终答案包含来源。

### Gemini 原生生图/改图

生图不复用文本 Agent 的 `MODEL_*` 协议，而是由宿主动态工具 `image.generate` 调用 Gemini 原生 `generateContent`。`IMAGE_BASE_URL` 配置到兼容 Gemini 原生接口的网关根路径（例如 `/antigravity`），适配器会请求 `/v1beta/models/<IMAGE_MODEL>:generateContent`；`operation=edit` 只允许读取当前任务已接收并完成安全处理的图片附件。生成结果经过类型、大小、ClamAV（如已配置）和 SHA-256 幂等校验后，使用当前机器人通道发送回原会话。

默认渠道由 `IMAGE_PROVIDER`、`IMAGE_BASE_URL`、`IMAGE_API_KEY`、`IMAGE_MODEL` 配置。新增同协议渠道只改 `IMAGE_PROVIDERS_JSON` 注册表，密钥应使用 `apiKeyEnv` 引用环境变量；只有新增完全不同协议时才需要增加一次 Provider 适配器。

若必须在**同一个 Gemini API 请求**中同时拥有 Google Search 和自定义函数，需要改用支持 Gemini 3 工具组合的官方 Gemini API 路由及相应凭证，而非当前 Antigravity OAuth 路由。当前文本模型由 `MODEL_PROVIDER` 选择；公网模型中转地址使用 HTTP 时，`npm run check:env` 会报错，正式使用前应改为 HTTPS。

## 5. 启停、更新与状态

```powershell
docker compose up -d
docker compose ps
docker compose logs --tail 200 gateway
curl.exe --fail http://127.0.0.1:8080/healthz
curl.exe --fail http://127.0.0.1:8080/readyz
curl.exe --fail http://127.0.0.1:8080/metrics
```

- `/healthz`：HTTP 进程存活。
- `/readyz`：PostgreSQL、Redis、Codex App Server、钉钉 Stream 均可用。
- `/metrics`：进程与任务指标。
- `/internal/messages`：只用于受控测试；生产环境必须携带 `x-internal-token`，且不能暴露公网。

更新：

```powershell
docker compose build gateway
docker compose up -d gateway
curl.exe --fail http://127.0.0.1:8080/readyz
```

若新版本失败，使用上一个已验证镜像重新标记并启动；不要回滚已应用且包含数据变更的迁移，优先以前向迁移修复。

## 6. 备份与恢复

`postgres-backup` 启动后立即备份，此后每 15 分钟生成 `/backups/agent-<UTC时间>.dump`；90 天前文件自动删除。备份使用 PostgreSQL custom format，写临时文件后原子重命名。

检查最新备份：

```powershell
docker compose exec -T postgres-backup sh -ec 'ls -lh /backups; set -- /backups/agent-*.dump; pg_restore --list "$1" >/dev/null; echo "$1"'
```

恢复前停止写入：

```powershell
docker compose stop gateway postgres-backup
docker compose run --rm --no-deps --entrypoint pg_restore postgres-backup --clean --if-exists --no-owner --dbname=agent /backups/<backup-file>.dump
docker compose up -d postgres-backup gateway
curl.exe --fail http://127.0.0.1:8080/readyz
```

正式恢复前建议先恢复到临时数据库并检查 `schema_migrations`、`tasks`、`approvals` 和 `audit_events`。

## 7. 验收命令

```powershell
npm run build
npm test
npm audit --omit=dev --audit-level=moderate
docker compose config --quiet

$env:DATABASE_URL='postgres://agent:agent@localhost:5432/agent'
$env:REDIS_URL='redis://localhost:6379'
$env:CLAMAV_HOST='127.0.0.1'
npm run migrate
npm run test:postgres
npm run test:queue
npm run test:clamav
npm run test:codex-restart
npm run test:codex-thread
```

`test:queue` 会验证同用户串行、同时间任务顺序以及失败耗尽重试后自动放行后续任务。`test:clamav` 会验证正常数据为 `OK`，标准 EICAR 测试载荷为 `FOUND`。

## 8. 故障恢复

模型兼容网关会在转发首个有意义的 SSE 数据帧前检查空流，仅暂存心跳及 output 为空的 response.created/response.in_progress 元数据。Sub2API Antigravity 在发送心跳后可能返回 `event: error` 和 `upstream_error/empty_stream`，即使 HTTP 状态已经是 200；网关也识别 output 为空且 error.code 为 empty_stream 的标准 response.failed 终止事件，只重试同一个模型请求，保留请求中的历史工具结果，不重跑整个业务任务。空流、HTTP 错误和请求超时共用 `MODEL_REQUEST_MAX_ATTEMPTS` 与 `MODEL_REQUEST_RETRY_BUDGET_MS`；等待首个有效数据帧也受 `MODEL_REQUEST_ATTEMPT_TIMEOUT_MS` 限制。日志中的 `model request retry scheduled` 会标注 `reason: empty_stream`。任何文本、工具、非空 output 或未知数据帧转发后禁止自动重放，未知错误帧也不按空流重试。该恢复不能证明上游空流的根因已经修复；完整验收仍需群聊真实任务与 PDF 交付通过。

任务闭环上线时可先设置 `TASK_WORKFLOW_MODE=shadow`，观察审计事件 `workflow.plan`、`workflow.shadow_plan_failed`、`workflow.shadow_comparison`、`capability.observed` 与原任务结果的差异。`shadow` 不要求提交完成契约，也不会将澄清请求发给用户；完成验收后设为 `enforce`，宿主才会要求证据审查通过后结束任务。`off` 用于隔离闭环故障。上线时先部署 CrossBorderOps 的 `daily.performance_changes` 服务端聚合，再启用 Agent 的 `enforce`，避免能力目录先于数据接口生效。

Codex 启动前会枚举其配置里的所有原生 MCP 服务并禁用；枚举失败时拒绝启动。新增业务连接器必须先登记到宿主代理与能力目录，不能依赖原生 MCP 直连。

审计检查重点：有内部经营事实需求但没有 `crossborderops.*` 调用就完成的任务；连续目录查询超过预算；证据审查拒绝的因果表述；`waiting_clarification` 超时、取消、重启后的恢复。审计记录只保存能力 ID、结果和脱敏错误，不保存工具原始结果或凭证。

- Stream 断线：SDK 自动重连；消息按 `messageId` 去重。
- Codex App Server 异常退出：当前 Turn 立即失败，不等待十分钟超时；下一任务自动启动新进程。
- PostgreSQL 不可用：`/readyz` 返回 503，任务不得被宣称完成。
- Redis 不可用：`/readyz` 返回 503；恢复后 Worker 继续消费。失败任务耗尽重试时清除用户顺序队列头。
- DWS Token 失效：停止工具调用，重新私聊设备授权；禁止管理员身份兜底。
- 写操作网络超时：工具调用标记为 `unknown`，禁止自动重试，由人工核对目标系统状态。
- ClamAV 不可用或返回非 `OK`：附件处理失败，不将附件内容交给 Agent。
- sessionWebhook 缺失或过期：使用 `DWS_BOT_PROFILE` 向原私聊或原群主动发送。

## 9. 保留与敏感信息

- 任务、审计、审批、收件箱去重数据和媒体默认保留 90 天。
- 用户记忆只保存用户明确要求记录的普通偏好；凭证、Token、密码、Cookie、验证码和密钥会被拒绝。
- 私聊和群聊原始 Thread 隔离；只有过滤后的用户偏好可跨场景共享。
- 日志不得包含 `.env`、OAuth 返回体、DWS 配置目录内容或附件原文。

## 10. 排查规划与工具调用

用户无需查看内部编号。运维人员可根据发生时间和原问题在 `tasks` 表定位任务 ID，再查询审计事件。`workflow.planner_attempt`、`workflow.planner_draft`、`workflow.planner_review`、`workflow.planner_invalid` 分别记录规划尝试、脱敏后的结构化草案、审查结论和解析/审查异常。`tool.call_started` 与 `tool.call_finished` 记录实际工具名称、参数字段名与摘要指纹、状态、耗时和证据 ID，不记录参数原值。`task.failed` 记录最终错误。审计记录按 `TASK_RETENTION_DAYS` 保留（默认 90 天）。

```sh
docker compose exec -T postgres psql -U agent -d agent -c "SELECT id, created_at, status, input_text FROM tasks WHERE created_at >= '<开始时间>' AND created_at < '<结束时间>' AND input_text LIKE '%<问题关键词>%' ORDER BY created_at DESC;"
docker compose exec -T postgres psql -U agent -d agent -c "SELECT created_at, event_type, payload FROM audit_events WHERE task_id='<任务编号>' ORDER BY id;"
```

独立任务规划器通过模型 Responses 接口取得的是可见 JSON 输出，不取得或保存模型隐藏推理文本；Codex 的执行回合在规划通过后才开始。排查时请依据草案、审查结论、工具调用及任务状态还原可观察的执行过程。审计表包含用户任务内容的衍生信息，仅限授权运维人员访问，不应转发到其他聊天场景。
