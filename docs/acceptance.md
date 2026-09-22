# 项目验收记录

验收日期：2026-09-21

| 需求 | 实现 | 验证 | 结果 |
|---|---|---|---|
| 钉钉私聊与群聊接入 | Stream SDK 适配；群聊显式未 @ 时忽略；Markdown 回复 | 消息解析与路由单测 | PASS |
| 文本与媒体消息 | 文本、图片、语音、视频、文件、富文本、引用消息；下载、限额、类型识别与抽取 | 单测；ClamAV 真实 clean/EICAR Smoke | PASS |
| Codex App Server | stdio JSON-RPC initialize、Thread、Turn、事件、审批请求、异常重启 | 宿主机与容器 `test:codex-restart`；容器 `test:codex-thread` | PASS |
| 内部 Skill 读取与 shell 边界 | 关闭容器中不可用的原生 shell；`reference.read_guide` 只读白名单；旧 Thread 恢复时刷新工具；Codex shell/文件提权拒绝；业务写入仍走 DWS 确认 | 真实模型 `test:codex-readonly`：新会话与重启后旧会话均调用说明工具成功、无 shell、无审批；Guide/Orchestrator 测试 | PASS |
| 完整 DWS 能力接入 | 从 DWS 1.0.62 生成 507 项能力注册表；动态工具 Schema；任意命令和敏感参数拒绝 | 注册表重新生成；真实 Codex `thread/start` 接受 507 项 Schema | PASS |
| 用户身份隔离 | 业务命令强制 `<corpId>:<userId>` Profile；授权后核对身份；禁止管理员 Token 兜底 | DWS 工具、策略与 Orchestrator 测试；真实 DWS 自身查询 | PASS |
| 机器人身份回消息 | sessionWebhook 优先；缺失时通过 `robot_code + DWS_BOT_PROFILE` 主动回原私聊/原群 | 参数与失败处理代码测试；真实钉钉发送需生产 Profile | BLOCKED |
| 用户 OAuth 与任务恢复 | 设备授权私聊发起人；授权成功后恢复原任务；状态持久化 | 授权、审批、恢复路径单测 | PASS |
| 写操作确认 | 写/高风险操作展示目标与影响；只接受 `确认 <任务编号>`；可取消与过期 | Policy、Markdown、Orchestrator 测试 | PASS |
| 写操作幂等 | action hash + idempotency key；完成结果复用；started/unknown 禁止自动重试 | PostgreSQL 真实 Smoke 与 Orchestrator 测试 | PASS |
| 会话与长期记忆隔离 | 原始 Thread 按用户与场景隔离；过滤后的偏好按用户共享；敏感内容拒绝 | Memory、Repository、Orchestrator 测试 | PASS |
| 500 人/30 并发模型 | BullMQ Worker 并发 30；Redis 用户锁与顺序集合保证同用户串行 | 真实 Redis Smoke：同用户并发 1、同时间顺序、失败耗尽后放行 | PASS |
| 持久化与恢复 | PostgreSQL 任务、会话、审批、工具调用、审计；版本化迁移与 advisory lock | 真实迁移；Repository Smoke；恢复状态测试 | PASS |
| 备份与保留 | 每 15 分钟 custom-format 备份，90 天保留；业务与媒体 90 天清理 | 真实备份生成、`pg_restore --list`、临时数据库恢复演练 | PASS |
| 容器安全与运行时 | 非 root、只读根文件系统、no-new-privileges、独立 Codex/DWS/媒体/工作区 Volume、bubblewrap | 最新镜像构建；容器内 Codex 重启和全部依赖 Smoke | PASS |
| 健康检查与内部接口 | health、ready、metrics；生产内部接口要求 32 字节以上 Token | Server 单测，依赖失败返回 503、无 Token 返回 401 | PASS |
| 生产钉钉端到端 | 真实 Stream、机器人消息、每类真实附件、Token 刷新、授权恢复 | 生产配置与 Gateway 已就绪；部分真实用户路径仍未逐项覆盖 | BLOCKED |
| 流式文本卡片 | 原生 AI 卡片模板 `bf334029-38b1-4d85-aefc-1039fc0534e5.schema`；`content` 全量更新；唯一 guid；最终 finalize；DWS 降级 | 原生 Broker 单测；Docker 构建；真实群投递；用户现场确认 Markdown、长文本和状态切换效果 | PASS |
| 独立过程区与答案区 | 当前模板 `e08def5f-27fb-451b-ab01-cc568915bfee.schema`；`activity` 静态变量与 `content` 流式变量分离；过程文案去重，首段答案后清空过程文案，完成时不再额外更新 activity；处理态工具提示开关待下一版模板 | TypeScript 构建、51 项测试、Docker 构建、Gateway ready。现模板未在“处理中”绑定 activity，故 `DINGTALK_CARD_ACTIVITY_IN_PROCESSING` 暂保持 false；新状态布局和客户端观感未验证 | BLOCKED |

## 本轮实际结果

- TypeScript 构建：PASS
- Vitest：13 个文件、41 项测试全部 PASS
- npm production audit：0 vulnerabilities，PASS
- Docker Compose 配置：PASS
- PostgreSQL 迁移与 Repository Smoke：PASS
- Redis/BullMQ 顺序、并发和失败恢复 Smoke：PASS
- ClamAV clean/EICAR Smoke：PASS
- PostgreSQL 备份与临时库恢复：PASS
- Gateway 镜像构建：PASS
- 容器内 Codex 异常重启：PASS
- 容器内完整 507 项动态工具 `thread/start`：PASS
- 容器内真实模型基础回合、Skill 读取、shell 反向尝试和 Thread 恢复：PASS；未触发 shell 或用户确认
- 数据库中升级前的真实会话 Thread：`test:codex-existing` 恢复成功，未发送钉钉消息
- 运行中 Gateway `/readyz`：PostgreSQL、Redis、Codex、钉钉 Stream 全部 ready
- 流式卡片：DWS schema/dry-run、镜像构建和 003 迁移 PASS；当前已切换原生 AI 卡片模板
- 原生 AI 流式卡片：真实模板创建与多次 `isFull` 更新、最终 finalize 请求成功；用户已确认长文本 Markdown 和最终显示效果

## BLOCKED 条件

生产配置与 Gateway 已就绪。尚需在当前版本中由实际钉钉用户再次验证完整私聊/群聊、OAuth 恢复、确认写入和各类附件路径；本轮没有向群聊发送新消息，也没有执行真实业务写入。
