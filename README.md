# 钉钉企业 Agent Gateway

基于钉钉 Stream、Codex App Server 和 DWS CLI 的企业内部 Agent 网关。默认使用钉钉原生 AI 流式卡片，以 Markdown 形式在同一张卡片中持续更新进度与结果；DWS 流式文本卡片仅作为降级方案。流式文本卡片不是 A2UI 组件卡片。

## 已实现能力

- 钉钉私聊与群聊消息接入；群聊未 @ 机器人时忽略。
- 文本、图片、语音、视频、普通文件、富文本和引用消息解析。
- 钉钉会话按 `corpId + userId + 场景` 映射到独立 Codex Thread。
- Codex App Server 使用 stdio JSON-RPC，支持动态 DWS 与用户记忆工具。
- 当前 Docker 环境无法建立 Codex 的 Linux shell 沙盒，因此关闭原生 shell，改由 `reference.read_guide` 结构化只读工具读取已注册 Skill；工具不访问员工资料或凭证，也不触发钉钉确认。Codex 子进程不继承钉钉、数据库或 DWS 配置环境变量。
- 507 项 DWS 能力白名单；模型不能提交任意 CLI 路径、Profile、Token 或应用密钥。
- 每位员工使用自己的 `corpId:userId` DWS Profile，服务端权限仍由钉钉校验。
- 查询可直接执行；创建、修改、发送、审批、删除、权限和批量操作必须由发起人确认。
- PostgreSQL 持久化任务、会话、审批、工具幂等状态、用户记忆和审计。
- Redis/BullMQ 支持最多 30 个用户并行，同一用户严格串行；失败耗尽重试后不会阻塞后续任务。
- 写操作具备幂等保护；状态未知时禁止自动重试。
- 用户长期偏好按 `corpId + userId` 隔离，原始对话仍按私聊/群聊场景隔离。
- 附件大小限制、类型识别、ClamAV 扫描和 Office/PDF 文本抽取。
- 90 天数据与媒体清理；PostgreSQL 每 15 分钟备份并保留 90 天。
- `/healthz`、`/readyz`、`/metrics` 与受 Token 保护的内部测试入口。

## 架构

```text
钉钉员工 / 群聊
      │ Stream 消息
      ▼
Gateway ── PostgreSQL（任务、会话、审批、审计、记忆）
   │     ├ Redis/BullMQ（并发与同用户顺序）
   │     └ ClamAV（附件扫描）
   │
   ├── Codex App Server（理解、规划、Skill、动态工具）
   │       └── 兼容 Responses API 的模型中转
   │
   └── DWS CLI
           ├── 当前员工 Profile：业务资源读写
           └── Bot Profile：仅用于机器人身份回消息
```

关键边界：业务操作永远使用当前聊天用户的 DWS Profile；`DWS_BOT_PROFILE` 只负责机器人身份发送结果，不能替代员工访问业务资源。

Codex 运行状态保存在独立 `codex-data` Volume；Gateway 根文件系统保持只读。

## 生产配置

复制示例文件并只在本机或 Secret 管理系统中填写：

```powershell
Copy-Item .env.example .env
```

必须配置：

| 变量 | 用途 |
|---|---|
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` | 企业内部机器人应用与 Stream 连接、媒体接口 |
| `DINGTALK_ROBOT_CODE` | 机器人发送身份 |
| `DWS_BOT_PROFILE` | 可选。已授权的机器人发送 Profile，仅 DWS 卡片降级与群消息回退路径需要；员工授权引导私聊走钉钉原生机器人接口，不依赖它 |
| `MODEL_BASE_URL` / `MODEL_API_KEY` | 兼容 Responses API 的模型中转地址与密钥 |
| `MODEL_NAME` | 中转支持的模型名 |
| `INTERNAL_API_TOKEN` | `/internal/messages` 的 32 字节以上随机 Token |

可用 PowerShell 生成内部 Token：

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

不要提交 `.env`，不要在日志、任务文本或用户记忆中保存 Token、AppSecret、密码或设备验证码。

## Docker 启动

```powershell
docker compose up -d postgres redis clamav postgres-backup
docker compose build gateway
docker compose up -d gateway
docker compose ps
```

若当前网络无法直连 Docker Hub，可只对本次构建指定镜像代理：

```powershell
$env:NODE_IMAGE='m.daocloud.io/docker.io/library/node:22-bookworm-slim'
docker compose build gateway
```

这不会修改生产默认镜像；默认仍为 `node:22-bookworm-slim`。

## DWS Bot Profile 初始化

首次部署时，在挂载同一 `dws-data` 卷的一次性容器中完成设备授权：

```powershell
docker compose run --rm --no-deps gateway npm run auth:dws-bot
docker compose run --rm --no-deps gateway dws profile list --format json
docker compose run --rm --no-deps gateway dws auth status --profile <corpId>:<userId> --format json
```

登录脚本会检查机器人应用配置，但用户设备授权使用 DWS 从 MCP 获取的托管 OAuth
Client。机器人 AppKey/AppSecret 不能传给 DWS 设备码接口：它们用于 Stream 和机器人
应用接口，不代表该 AppKey 已注册为登录设备流客户端。不要在命令行粘贴 AppSecret。

Compose 将 `DWS_KEYCHAIN_DIR` 固定到 `/var/lib/dws/keychain`。该路径位于持久化的
`dws-data` 卷中，使 DWS 能在 Gateway 根文件系统保持只读时安全保存加密凭据与 DEK。

将最终 Profile Key 写入 `.env` 的 `DWS_BOT_PROFILE`。员工业务 Profile 无需管理员预先批量创建：员工首次访问受保护资源时，机器人会私聊设备授权入口；授权完成并核对 `corpId + userId` 后自动恢复原任务。

## Markdown 交互

- 收到任务：返回任务编号与排队状态。
- 超过 15 秒：返回当前处理阶段。
- 需要员工 OAuth：在发起人私聊发送设备授权入口。
- 写操作：返回目标、参数和影响，用户回复 `确认 <任务编号>` 才执行。
- 内部只读 Skill 读取：无需确认；shell 提权和工作区文件修改不会通过业务确认放行。
- 取消：回复 `取消 <任务编号>`。
- 完成或失败：回到原会话；授权和个人资源信息只回发起人私聊。

## 原生 AI 流式卡片

生产配置使用 `DINGTALK_CARD_TEMPLATE_ID` 和 `DINGTALK_CARD_VARIABLE=content`。网关通过钉钉原生 AI 卡片接口创建实例，并用 `isFull=true`、唯一 `guid` 和最终 `isFinalize=true` 持续更新同一卡片。群聊写操作的完整确认内容仍私聊发起人，群卡片只显示等待确认。原生接口失败时才回退到 DWS/Markdown 路径；更新失败时至少另发最终结果，避免任务结果丢失。

卡片内容使用真实换行的 Markdown，不要在命令行字符串中传字面量 `\\n`。模板变量必须与开发者后台保持一致。

## 本地与容器验收

```powershell
npm ci
npm run build
npm test
npm audit --omit=dev --audit-level=moderate

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

容器内依赖链验收：

```powershell
docker compose run --rm --no-deps gateway sh -ec 'codex --version; dws --version; npm run migrate; npm run test:postgres; npm run test:queue; npm run test:clamav'
docker compose run --rm --no-deps gateway npm run test:codex-readonly
docker compose run --rm --no-deps gateway npm run test:codex-existing
```

完整生产就绪检查：

```powershell
curl.exe --fail http://127.0.0.1:8080/readyz
```

`/readyz` 只有在 PostgreSQL、Redis、Codex App Server 和钉钉 Stream 全部真实可用时才返回成功。

更详细的备份恢复、更新、故障处理与权限矩阵见 [docs/operations.md](docs/operations.md)。

逐项完成状态与外部阻塞条件见 [docs/acceptance.md](docs/acceptance.md)。
