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
| Codex shell 提权、访问其他目录、文件修改 | 不允许通过业务确认放行 | 否，直接拒绝并审计 | Agent 继续尝试已注册工具或报告限制 |

禁止使用管理员 Token 替员工访问资源。钉钉服务端是最终权限裁决者；网关同时强制 Profile 身份匹配和 DWS 能力白名单。
Codex 的业务写入必须经过结构化动态工具，不能把通用 shell 审批当作业务授权。仅模型连接凭证会传给 Codex 子进程；部署时应给模型中转密钥设置独立限额。
当前 Docker Desktop 容器无法建立 bubblewrap 用户命名空间，故原生 shell 工具已关闭。若以后需要通用 shell，应先在独立隔离容器中验证实际沙盒、凭证隔离和写入策略，不得直接通过用户的钉钉确认放行。

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

模型实际调用 `dingtalk.dws` 且当前员工尚未授权时，任务进入 `waiting_oauth`；网关不再根据用户消息关键词预判工具路由：

1. 网关使用 DWS 托管 OAuth Client 发起 `dws auth login --device`，Profile 固定为 `<corpId>:<userId>`；不得注入机器人 AppKey/AppSecret。
2. 授权地址与一次性验证码只私聊发起人。
3. 授权完成后调用 `dws auth status --profile <corpId>:<userId>`。
4. 返回身份必须与消息的 `corpId + userId` 完全一致，否则拒绝并记录错误。
5. 匹配后恢复原任务；Token 过期时重新进入此流程。

网关不保存或输出 access token、refresh token、设备验证码和 AppSecret。

### Gemini 原生联网

当前 Sub2API 账号使用 Antigravity OAuth 路由。该路由不能在同一上游请求中混用 Google Search 内建工具与自定义函数工具。因此网关将 `internet.search` 作为 Codex 动态工具始终提供给模型：是否调用完全由模型决定，不做关键词分流；实际查询由单独的 Gemini Responses 请求携带 `tools: [{"type":"web_search"}]` 执行，并要求返回 grounding 来源后才算成功。它是同一 Agent 任务中的模型决策工具调用，**不是**同一个 Gemini 请求里同时声明 Google Search 和钉钉函数。

当前 Sub2API Antigravity Responses 桥还会丢失 Codex 命名空间子工具名。启用 `MODEL_TOOL_COMPAT_PROXY=true` 后，网关对所有命名空间工具统一执行可逆名称映射（例如 `dingtalk.dws` ↔ `dingtalk__dws`），只处理协议字段，不读取消息内容或按关键词决定工具。模型中转恢复可用后运行 `docker compose exec -T gateway npm run test:codex-native-web` 做真实联网验收；检查模型确实调用了工具、Gemini 返回 grounding、最终答案包含来源。

若必须在**同一个 Gemini API 请求**中同时拥有 Google Search 和自定义函数，需要改用支持 Gemini 3 工具组合的官方 Gemini API 路由及相应凭证，而非当前 Antigravity OAuth 路由。公网 `MODEL_BASE_URL` 目前使用 HTTP 时，`npm run check:env` 会报错；正式使用前应改为 HTTPS。

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
