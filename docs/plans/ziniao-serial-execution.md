# 紫鸟操作全局串行化落地方案

状态：待评审
日期：2026-09-23
前提：紫鸟官方明确"支持多账号切换使用，不支持多账号同时调用 CLI"。`USERPROFILE/HOME` 隔离只是实验性凭证隔离，不构成官方认可的并发许可。本方案按"全局串行"落地，不宣称并发。

---

## 0. 结论

**能做到。** 授权模型已经满足"凭证在 Agent 那台机器上"的要求：`ensureZiniaoAuthorization` 私聊发 `memberAuth` 链接 → 用户浏览器完成申请 → CLI 把 apiKey/companyId 写入执行机上该用户专属目录（`C:\ProgramData\DingtalkZiniao\users\<sha256(corpId,userId)>`），DB 只存非敏感 profile 标识。本方案**不改动授权模型**，只补上缺失的执行机级串行。

方案 = 三层：

| 层 | 位置 | 作用 |
|---|---|---|
| L1 网关闸门 `ZiniaoGate` | `src/ziniao-gate.ts`（新增） | 主闸门：全局 FIFO 排队、公平、可取消、可观测，含"会话租约"防多步工作流被插队 |
| L2 执行机机器锁 | `remote/ziniao-worker-win.mjs`、`remote/ziniao-worker.mjs` | 兜底：保证执行机上任何时刻最多一个 ziniao-cli 进程（官方硬约束），闸门失效时快速失败 `ZINIAO_BUSY` |
| L3 会话租约 | L1 内实现，L3 由 orchestrator 触发释放 | 一次任务内的连续桥接命令（store open → page screenshot → store close）持有同一把锁，防止用户 A 两步之间被用户 B 插入 |

---

## 1. 现状与并发风险清单

调用链（生产路径，`ZINIAO_REMOTE_HOST` 已配置时）：

```
钉钉消息 → server /internal/messages → TaskOrchestrator.accept
  → BullMQ（30 并发 worker；同用户经 Redis sequence+lock 严格串行，跨用户并行）
  → run() → codex.turn → 模型调用 ziniao.cli
  → handleCodexRequest（parse → read/write 分级 → status 预检 → 授权或确认 → execute）
  → ZiniaoTool.execute → ZiniaoBroker.runCommand
  → ZiniaoRemoteBroker.start → 每次操作一条 SSH 强制命令 → ziniao-worker-win.mjs
  → spawn ziniao-cli.exe（USERPROFILE=用户专属目录）→ 服务端 API 或 127.0.0.1:9481 ZClaw Bridge
```

已就位的隔离：

- 每用户独立 CLI 配置目录（worker 以 `sha256([corpId,userId])` 选 HOME；本地 broker 同逻辑）。
- 同一钉钉用户任务严格串行（`task-queue.ts` per-user zset + lock）。
- worker 校验 `args[0]` 白名单、禁 `--profile/--api-key/--config`，防跨用户凭证指定。

未处理的并发风险：

| # | 风险 | 触发路径 |
|---|---|---|
| H1 | 执行机上同时跑两个不同用户的 ziniao-cli 进程 | 两个用户任务并行（BullMQ 30 并发），各自 `run`/`status` SSH 请求 |
| H2 | Bridge 浏览器环境被交叉操作：A `store open` 后 B `store open`，A 的 `page screenshot` 拍到 B 的店铺 | Bridge 单实例单登录态，`store/page/automation/utility/zclaw` 共用 127.0.0.1:9481 |
| H3 | 授权 `config init` 与其他命令并发 | `ensureZiniaoAuthorization` 最长持有 15–16 分钟，期间他人命令照常执行 |
| H4 | `status` 预检与 `run` 之间的 TOCTOU | 每次调用前独立 `status` SSH 往返 |
| H5 | 多步工作流被拆散 | 模型在一次 turn 内发起多次 `ziniao.cli` 调用（巡检 skill：list → open → wait-nav → screenshot → close × N） |
| H6 | 排队不可见、不可取消 | 用户不知道要等多久；取消任务后 gate 等待者残留 |

关键结论：**按单次调用加锁不够（H5/H2），必须按"任务会话"持锁；纯服务端 API 命令（account/staff/department/role/device/api）无状态，单次持锁即可。**

---

## 2. 目标与非目标

**目标**

1. 执行机上任何时刻最多一个 ziniao-cli 进程（官方约束，硬保证由 L2 兜底）。
2. 同一用户任务内连续桥接命令之间不被其他用户插入（L3 会话租约）。
3. 排队有反馈（卡片 activity 显示位次与等待时长）、可取消、有上限（等待超时/队列满时明确失败并给出指引）。
4. 授权期间他人排队且收到进度；授权完成自动恢复。
5. 不影响 DWS/领星/SIF/记忆等其余工具的并行度；同用户任务仍严格串行。

**非目标**

- 不做并发、不做多执行机路由。但 Gate 按"执行机资源键"设计（默认 `ziniao-executor-1`），未来加机器 = 新增资源键 + 路由，接口不变。
- 不解决 Bridge 店铺可见性的按 API Key 隔离问题（`docs/operations.md` 的 A/B 双成员验证前置项仍然有效，串行化不豁免它）。
- 不改授权凭证存放位置与流程。

---

## 3. L1：网关闸门 `ZiniaoGate`

### 3.1 API

```ts
// src/ziniao-gate.ts
export type ZiniaoOp = 'status' | 'run' | 'authorize';

export interface GateRequest {
  userKey: string;          // corpId:userId，仅用于日志与位置计算，不外显
  taskId: string;
  op: ZiniaoOp;
  namespace?: string;       // ziniao 命令空间；store/page/automation/utility/zclaw 触发会话租约
  shouldCancel?: () => boolean;  // orchestrator 注入 cancelledTasks 检查
  onWait?: (info: { position: number; depth: number; waitedMs: number }) => void;
}

export class ZiniaoGate {
  constructor(opts: {
    maxWaitMs: number;      // ZINIAO_GATE_MAX_WAIT_MS，默认 900_000
    maxWaiters: number;     // ZINIAO_GATE_MAX_WAITERS，默认 20
    sessionIdleMs: number;  // ZINIAO_SESSION_IDLE_MS，默认 180_000
    sessionMaxMs: number;   // ZINIAO_SESSION_MAX_MS，默认 1_800_000
    opMaxMs: Record<ZiniaoOp, number>; // status 25s / run 75s / authorize 17min，硬上限
  });

  // 单次操作：排队 → 持锁执行 fn → 释放
  withLease<T>(resource: string, req: GateRequest, fn: () => Promise<T>): Promise<T>;

  // 会话租约：同 userKey 已持有则 touch 并返回现有租约；否则排队获取
  acquireSession(resource: string, req: GateRequest): Promise<GateSession>;
  endSession(resource: string, userKey: string): Promise<void>;

  // 观测：给 /metrics 与进度消息用；对外只暴露位次与队列长度，不暴露他人身份
  snapshot(resource: string, userKey: string): {
    held: boolean; position: number | null; depth: number;
    holder: { op: ZiniaoOp; heldMs: number; kind: 'call' | 'session' } | null;
  };
}

export interface GateSession {
  touch(): void;            // 每次 CLI 调用后调用，刷新空闲 TTL
  release(): Promise<void>; // 任务结束/取消时调用（幂等）
}
```

实现要点：

- **FIFO**：等待者用数组（非 Promise 链），释放时按入队顺序唤醒队首；`shouldCancel()` 每 2s 轮询一次（`setInterval` + `unref`），取消者出队并 reject `ZINIAO_CANCELLED`。
- **队满**：等待者 ≥ `maxWaiters` 时立即 reject `ZINIAO_BUSY`（不排队）。
- **等待超时**：超过 `maxWaitMs` reject `ZINIAO_QUEUE_TIMEOUT`。
- **持锁硬上限**：超过 `opMaxMs[op]`（会话用 `sessionMaxMs`）强制释放，当前 `fn` 拿到的结果作废，reject `ZINIAO_GATE_LEASE_LOST`。防止悬挂 Promise 永久占锁。
- **会话租约**：持有者记录 `{ userKey, taskId, acquiredAt, lastTouchAt, timer }`；空闲 TTL 到期自动释放并触发队首唤醒。TTL 判定惰性（下次请求检查）+ 定时器双保险（`unref`，不阻止退出）。
- **单实例假设**：当前 docker-compose 只有一个 gateway，进程内闸门足够。若未来多副本：同接口换 Redis 实现（可复用 `task-queue.ts` 的 RENEW/RELEASE Lua 脚本模式）；届时 L2 机器锁仍然保证官方约束（并发请求得 `ZINIAO_BUSY`）。

### 3.2 Broker 接入（`src/ziniao-broker.ts` 重构）

核心原则：**闸门在 broker 基类内，所有入口自动被覆盖**；`ZiniaoRemoteBroker` 继承无需改动。

```
现状问题：runCommand() 内部调用 this.status()（ziniao-broker.ts:113），
若两层各自抢锁会自死锁 → 必须拆 raw/gated 两层。
```

改造：

```ts
export class ZiniaoBroker {
  private readonly gate: ZiniaoGate;
  private static readonly RESOURCE = 'ziniao-executor-1';
  private readonly bridgeNamespaces = new Set(['store', 'page', 'automation', 'utility', 'zclaw']);
  private readonly sessions = new Map<string, GateSession>(); // userKey → session

  // —— 公共入口（带闸门）——
  public async status(user): Promise<{profileKey} | null> {
    return this.gate.withLease(RESOURCE, this.req('status', user), () => this.statusRaw(user));
  }

  public async runCommand(user, args, opts?: { shouldCancel?, onWait? }): Promise<unknown> {
    const ns = args[0];
    if (this.bridgeNamespaces.has(ns)) {
      // 会话租约：同用户已有会话 → touch；否则排队获取
      const session = this.sessions.get(key(user)) ?? await this.acquireNewSession(user, opts);
      session.touch();
      try {
        return await this.gate.withLease(RESOURCE, this.req('run', user, opts), () => this.runRaw(user, args));
      } catch (e) {
        if (isLeaseLost(e)) this.dropSession(user);   // 硬上限触发，会话作废
        throw e;
      }
    }
    // 纯服务端 API：单次持锁（严格串行默认；两级锁穿插模式见 6A.5，默认关闭）
    return this.gate.withLease(RESOURCE, this.req('run', user, opts), () => this.runRaw(user, args));
  }

  public async beginAuthorization(user, opts?): Promise<AuthSession> {
    // 授权整体独占执行机（官方约束同样覆盖 config init）
    return this.gate.withLease(RESOURCE, this.req('authorize', user, opts), async () => {
      const raw = await this.beginAuthorizationRaw(user);
      return { ...raw, completion: raw.completion };  // 闸门覆盖整个 completion 等待期
    });
  }

  public async endSession(user): Promise<void> {
    const s = this.sessions.get(key(user));
    if (s) { this.sessions.delete(key(user)); await s.release(); }
  }

  // —— 原实现改名（不带锁）——
  private async statusRaw(user) { /* 现 status() 主体 */ }
  private async runRaw(user, args) { /* 现 runCommand() 主体；内部 this.status() 改 this.statusRaw() */ }
  private async beginAuthorizationRaw(user) { /* 现 beginAuthorization() 主体 */ }
}
```

注意点：

- `runRaw` 内原 `if (!await this.status(user)) throw ZINIAO_AUTH_REQUIRED` 必须改调 `statusRaw`，否则嵌套抢锁死锁。
- 会话 Map 以 `userKey` 为键；同用户任务已被 BullMQ 串行，同用户并发会话不存在。
- `ZiniaoTool.execute` 增加 `opts` 透传（`shouldCancel`/`onWait`），签名变更同步更新 `tests/ziniao-tool.test.ts`。
- 远端 broker 的 `start()` 每操作一条 SSH 连接的模型不变；"会话"只是网关侧概念，worker 只感知单次调用（由 L2 保证互斥）。

### 3.3 Orchestrator 集成（`src/task-orchestrator.ts`）

1. **任务结束释放会话**：`run()` 的 `finally` 块（现 472–478 行附近）追加：

```ts
await this.ziniaoBroker.endSession?.(task.request.user).catch(() => undefined);
```

   覆盖完成/失败/取消三条路径（取消分支 `return` 前仍会经过 `finally`）。等待审批（`waiting_confirmation`，最长 10 分钟）期间**不持锁**：写操作在 `waitForBusinessApproval` 之前只做单次 `status`，审批后 `executeIdempotentWrite → runCommand` 才获取会话；若审批期间空闲 TTL 过期，后续调用重新排队——这正是期望行为。

2. **排队进度**：ziniao 分支（现 568–610 行）把 `onWait` 接到卡片 activity：

```ts
onWait: ({ position, depth, waitedMs }) => {
  // 每 30s 节流一次；文案只含自己的位次与队列总长，不含他人身份（符合 AGENTS.md 隐私规则）
  void this.sender.updateTaskActivity?.(task.cardBizId!,
    `紫鸟执行机排队中：第 ${position} 位 / 共 ${depth} 个任务（已等待 ${Math.round(waitedMs / 1000)} 秒）`, 1);
}
```

3. **取消接线**：`shouldCancel: () => this.cancelledTasks.has(task.id)` 传入 `ziniaoTool.execute` 与 `ensureZiniaoAuthorization → beginAuthorization`。
4. **失败文案**（guidance map，现 596–606 行）新增：

| 错误码 | 用户文案 |
|---|---|
| `ZINIAO_BUSY` | 紫鸟执行机正忙（其他成员正在操作），本次未执行。请稍后重发任务。 |
| `ZINIAO_QUEUE_TIMEOUT` | 紫鸟执行机排队超时（等待超过 15 分钟仍未轮到）。请错峰重试，或缩小批量范围。 |
| `ZINIAO_GATE_LEASE_LOST` | 紫鸟执行机会话超时被回收，本次操作未完成。请重发任务。 |
| `ZINIAO_CANCELLED` | （任务已取消，无需文案） |

5. **审计**：`ziniao.gate_waited { waitedMs, position, op }`、`ziniao.session_released { heldMs }`、`ziniao.lease_lost`。

---

## 4. L2：执行机机器锁（兜底）

两个 worker 同步改造（win 与 linux 逻辑一致，路径不同）。

```js
// remote/ziniao-worker-win.mjs 增补
import { open, readFile, rm } from 'node:fs/promises';

const LOCK_PATH = join(root, 'cli.lock');
const LOCK_WAIT_MS = 10_000;      // 网关闸门正常时 0 等待；此处仅兜底
const LOCK_STALE_MS = 20 * 60_000; // 授权上限 16min + 余量

async function acquireLock(op, digest) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(LOCK_PATH, 'wx');   // 独占创建
      await handle.writeFile(JSON.stringify({ pid: process.pid, op, digest, at: Date.now() }));
      await handle.close();
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') return false;
      const stale = await isStale();                 // 读 at 字段；超龄删掉重试
      if (stale) { await rm(LOCK_PATH, { force: true }).catch(() => undefined); continue; }
      if (Date.now() >= deadline) return false;
      await new Promise(r => setTimeout(r, 250));
    }
  }
}
```

规则：

- **加锁范围 = 单次 CLI 调用**（`execute()` 前获取、finally 释放）。`status`/`authorize`/`run` 都spawn CLI，都要锁；`probe`（bridgeReady 探测）不 spawn CLI，不加锁。
- 获取失败（等满 10s）→ `emit({type:'result', ok:false, code:'ZINIAO_BUSY'})`，退出码 0（网关按业务码映射文案，不按 SSH 失败处理）。
- 陈旧回收按时间戳（20 分钟）判定，简化且跨平台；PID 存活检查（`process.kill(pid, 0)`）作为可选增强。
- 启动时先做一次陈旧清理。
- 防线意义：即使网关出现 bug、未来多副本、或有人手工 SSH 执行，执行机仍保证"任一时刻最多一个 CLI 进程"。网关闸门（L1）才是排队与体验层。

---

## 5. 配置项（`src/config.ts`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `ZINIAO_GATE_DISABLED` | `false` | 紧急绕过开关（仅应急，文档标注风险：绕过后仅剩 worker 锁兜底，请求会快速失败而非排队） |
| `ZINIAO_GATE_MAX_WAIT_MS` | `900000`（15 min） | 单次排队上限，超时 `ZINIAO_QUEUE_TIMEOUT` |
| `ZINIAO_GATE_MAX_WAITERS` | `20` | 队列容量，超出立即 `ZINIAO_BUSY` |
| `ZINIAO_SESSION_IDLE_MS` | `180000`（3 min） | 会话空闲 TTL |
| `ZINIAO_SESSION_MAX_MS` | `1800000`（30 min） | 会话硬上限（保护长巡检），到期 `ZINIAO_GATE_LEASE_LOST` |
| `ZINIAO_INTERLEAVE_READS` | `false` | 两级锁只读穿插开关（预留）。**紫鸟书面确认前不得开启**，见 6A.5 |
| `ZINIAO_GATE_METRICS` | `true` | 向 `/metrics` 暴露 `ziniao_*` 指标 |

op 硬上限随现有超时走：status 25s、run 75s（SSH 层已有）、authorize 17min（SSH 16min + 余量），在 Gate 内作为常量即可，不进 env。

`/metrics` 追加（`server.ts` registry 注入或快照抓取）：`ziniao_gate_queue_depth`（gauge）、`ziniao_gate_holder_held_ms`（gauge）、`ziniao_gate_wait_ms`（直方图或均值）、`ziniao_busy_total`、`ziniao_session_expired_total`、`ziniao_worker_lock_denied_total`。

---

## 6. 用户视角时序（验收基准）

```
场景 A：B 排队等 A 巡检
  A: "巡检所有店铺" → store list(0.5s) → [会话建立] store open → screenshot → ... 
  B: "看下店铺列表"（A 会话中）→ B 卡片 activity："紫鸟执行机排队中：第 1 位 / 共 1 个任务"
  A 任务结束（finally 释放会话）→ B 获得执行机 → store list 返回

场景 B：C 首次授权阻塞队列
  C 未授权 → status(null) → ensureZiniaoAuthorization
    → authorize 抢占执行机（最长 17min）→ 私聊收链接 → C 浏览器完成
    → completion → statusRaw 确认 → setZiniaoProfile → 释放 → C 的原命令执行
  期间 A/B 的 ziniao 任务排队；超 15min 得 ZINIAO_QUEUE_TIMEOUT 文案。

场景 D：审批不占执行机
  D: "把 X 店铺改名为 Y" → status 预检（几秒）→ 私聊确认 → 任务 waiting_confirmation
  （会话未建立或已空闲过期，执行机空闲，他人可用）
  D 回复"确认" → 任务重新调度 → executeIdempotentWrite → runCommand 重新排队获取 → 执行
```

---

## 6A. 排队交互设计（多用户同时触发）

决定（2026-09-23）：**严格全串行为默认**——B 的所有紫鸟命令（含只读短查询）都等 A 的整个会话/调用结束。两级锁（只读穿插）作为代码内置能力保留，由 `ZINIAO_INTERLEAVE_READS=false` 默认关闭，拿到紫鸟书面确认后再开启。因此 B 的等待可能长达十几分钟，"友好"必须靠下面的交互机制兜住。

### 6A.1 总原则

1. **不拒绝**：只要队列未满（20 个），B 的请求一律受理排队，不因"忙"直接失败。
2. **不静默**：进闸门 1 秒内卡片即有反馈，等待期每 30 秒刷新位次与已等待时长。
3. **不插队**：先来先服务，无优先级；B 重复发消息只会排在自己后面（BullMQ 同用户串行），不会产生第二个抢占者。
4. **不泄露**：B 只看到位次、队列长度、已等待时长，看不到 A 的身份、任务内容与命令（符合 AGENTS.md 隐私边界）。

### 6A.2 B 的完整时间线

| 阶段 | B 看到什么 | 机制 |
|---|---|---|
| 触发紫鸟工具 | activity：「紫鸟执行机正被占用，你的任务已排队：第 1 位 / 共 1 个任务」 | 进闸门立即 `onWait`，不等 15s 心跳 |
| 等待中 | 每 30s 刷新：「已等待 45 秒；巡检类长任务可能需要 5–15 分钟」 | Gate 定时回调 → `updateTaskActivity` |
| 想放弃 | 回复「取消 任务编号」，2 秒内出队，任务标记取消 | `shouldCancel` 轮询 `cancelledTasks` |
| 轮到自己 | activity：「已轮到你的任务，正在执行紫鸟操作」 | 获取租约成功回调 |
| 等待超 15 分钟 | 任务失败 + 替代建议（见 6A.4） | `ZINIAO_QUEUE_TIMEOUT` |
| 队列已满（20） | 立即失败：「执行机排队已满，请稍后再试」 | `ZINIAO_BUSY`，不无限积压 |

### 6A.3 模型侧的主动避让（关键友好机制）

严格串行的最大代价是 B 的短查询陪跑长会话，缓解放在**发起侧**：

1. 新增进程内只读能力 `utility.queue-status`（零锁、零 CLI、零 SSH）：返回 `{ busy, queueDepth, longestHeldMs, holderKind }`。加入 `readCapabilities`，在 tool/broker 层拦截直接返回 Gate 快照，worker 永远看不到它。
2. skill 指引（`ziniao-shared` 增补）：**发起批量类长任务前必须先查 `utility.queue-status`**；队列非空时模型主动告知用户："当前执行机有 N 个任务在排队，全量巡检会让其他成员等待约 X 分钟。可以：① 仍然执行；② 拆小批量；③ 稍后再跑。你选哪个？"——把取舍前移到 A 决策时，而不是让 B 事后干等。
3. 失败文案指导模型给出具体替代：错峰重试（如 10 分钟后）、缩小批量、拆成多次小任务。

### 6A.4 失败与边界场景

| 场景 | 文案（发给 B） |
|---|---|
| 排队超时 | 紫鸟执行机排队超时（15 分钟仍被占用），本次未执行。可以 10 分钟后再试；若是批量任务建议拆小或错峰。 |
| 队列已满 | 紫鸟执行机排队已满（20 个任务），请稍后再试。 |
| A 在首次授权中 | 同样显示"正被占用"；授权有 15 分钟硬超时会自动释放，不会永久卡住。 |

边界澄清：

- **B 的写操作**：确认（私聊审批，最长 10 分钟）与排队解耦——确认期间既不占也不等执行机，确认后才进入排队。B 不会被"确认 + 排队"双重卡住。
- **B 排队时又发新消息**：新任务排在 B 自己的队尾（同用户串行），不会插队；模型应提示"你有任务正在排队"。
- **A 的体验**：不打扰 A 的正常执行；A 的 activity 附加「当前有 N 个任务在排队」（无身份），提示 A 收敛批量规模。
- **不做自动重试**：排队超时后不静默重试（避免变相延长 B 等待且未经同意），交还用户决策。
- **可选增强（backlog，一期不做）**：执行机空闲时私聊最近因 BUSY/超时失败的用户"执行机空闲了，可重发任务"——涉及主动打扰，需产品确认后再排。

### 6A.5 两级锁（代码预留，默认关）

`ZINIAO_INTERLEAVE_READS=true` 时：会话锁只挡桥接命令与写操作；`readCapabilities` 中非桥接命令（account.list、staff.list 等服务端只读）只需等"当前这一次 CLI 调用"结束即可执行（通常几秒），不整场陪跑。实现为 Gate 内两级资源（session 锁 → process 锁，获取顺序固定，无循环等待），执行机任一时刻仍最多一个 CLI 进程。**开启前置条件：紫鸟书面确认"会话间隙穿插只读调用"可行。**

---

## 7. 与现有机制的交互矩阵

| 机制 | 交互 | 结论 |
|---|---|---|
| BullMQ per-user 串行（task-queue.ts） | 不变 | 同用户任务仍严格串行；跨用户由 Gate 排队 |
| `waiting_confirmation`（10min 审批） | 审批期不持锁 | 空闲 TTL 自然过期；确认后重新排队 |
| 任务取消（`取消 任务号`） | `shouldCancel` 注入 + finally `endSession` | 等待者 2s 内出队；持锁者在当次调用结束后释放 |
| 网关重启 | 内存 Gate 丢失 | worker 锁陈旧回收兜底；会话丢失无害（下次重新排队） |
| 未来多网关副本 | 进程内 Gate 失效 | worker 锁仍保证官方约束（`ZINIAO_BUSY` 快速失败）；升级路径=Redis Gate 同接口替换 |
| 群聊结果私聊（privateZiniaoResults） | 不受影响 | 路由逻辑不变 |
| 写操作幂等（executeIdempotentWrite） | 不受影响 | 幂等键与闸门正交；`ZINIAO_QUEUE_TIMEOUT` 发生在幂等记录前，无"已写入未知"风险 |
| `config use`/全局 profile | 本就不允许（forbiddenFlags） | 不变 |
| 本地 `ZiniaoBroker`（无远端，开发态） | 同样过闸门 | 开发态也串行，行为与生产一致 |

---

## 8. 测试计划

**单元（vitest，随 `npm test` 跑）**

- `tests/ziniao-gate.test.ts`（新增）：FIFO 顺序；`maxWaiters` 拒绝；`maxWait` 超时；`shouldCancel` 出队；会话 touch/release/TTL 过期/硬上限；`opMaxMs` 强制释放；`snapshot` 不泄露他人身份。
- `tests/ziniao-tool.test.ts`（更新）：`execute` 透传 opts；`utility.queue-status` 进程内返回且不触碰 broker CLI 路径；bridge 命令走会话、非 bridge 单次锁（用带记录的 fake broker 断言 acquire/touch 次数）。
- `tests/orchestrator.test.ts`（更新）：任务结束 `endSession` 被调用（含取消路径）；`ZINIAO_BUSY`/`ZINIAO_QUEUE_TIMEOUT` 映射为对应 guidance；排队时 activity 更新被调用。
- 回归：`test:queue`（BullMQ 序列化语义不变）。

**执行机冒烟（手工，一次性）**

- `scripts/ziniao-worker-lock-smoke.mjs`（新增，仅在执行机运行）：并发两条 SSH 请求 → 第二条得 `ZINIAO_BUSY`；串行两条 → 全成功；预置超龄锁文件 → 自动回收。win/linux 各跑一遍。

**验收（真实环境）**

- 双账号（温敏娟 + 杨新）同时发起店铺巡检：观察卡片排队提示、执行机同时只有一个 ziniao-cli 进程（任务管理器验证）、结果互不串店。
- 首次授权阻塞场景：新成员授权期间，他人任务收到排队提示并最终成功或超时文案正确。

---

## 9. 实施顺序（PR 切分与上线）

| 阶段 | 内容 | 依赖 | 回滚 |
|---|---|---|---|
| PR1 | worker 机器锁 + smoke 脚本（win/linux） | 无 | 撤销 worker 文件即可，网关无感 |
| PR2 | `ziniao-gate.ts` + broker 拆 raw/gated + 单测 | 无 | 回滚镜像 |
| PR3 | orchestrator 集成（endSession / onWait / shouldCancel / 文案 / audit）+ 测试 | PR2 | 回滚镜像 |
| PR4 | config 项 + /metrics 指标 + 文档（operations.md 新章节"紫鸟执行机串行化"、README 能力清单一行、`skills/ziniao-shared/SKILL.md` 增"串行与排队"节） | PR2 | 回滚镜像 |

上线顺序：**先执行机锁（PR1）→ 再网关（PR2–4）**。worker 锁先行期间，网关尚无排队逻辑，用户可能偶见 `ZINIAO_BUSY` 文案——需在 PR4 文案上线前由管理员知晓（或 PR1 仅部署但不启用，等 PR3 一起上）。

---

## 10. 明确的限制（写入文档与 skill）

1. **会话空闲过期**：3 分钟无 CLI 调用（页面加载卡住、模型长时间思考、用户补充附件）会话释放，他人可插入；本任务下一次 CLI 调用重新排队，但 Bridge 浏览器状态可能已变。缓解：巡检 skill 已约定"每店铺操作完即 close"；`ziniao-shared` 增补指引——"重新获得执行机后先 `store open` 再继续，不要假设上一步的浏览器状态仍在"。
2. **授权独占**：首次授权最长独占执行机约 15 分钟，他人任务最长排队 15 分钟。
3. **串行 ≠ 权限隔离**：Bridge 以客户端当前登录身份可见/可操作店铺；per-user API Key 的服务端权限隔离仍以 `docs/operations.md` 的 A/B 双成员验证通过为准，该项未完成前不切 Windows 执行机。
4. **吞吐**：串行后紫鸟任务吞吐 = 执行机单任务吞吐。以当前团队规模（个位数运营、低频店铺操作）可接受；未来并发需求走"多执行机 + 资源键路由"（Gate 接口已预留）。

---

## 附：涉及文件清单

| 文件 | 动作 |
|---|---|
| `src/ziniao-gate.ts` | 新增 |
| `src/ziniao-broker.ts` | 重构：raw/gated 拆分、会话租约、endSession |
| `src/ziniao-tool.ts` | `execute` 增加 opts 透传；新增 `utility.queue-status` 进程内只读能力 |
| `src/task-orchestrator.ts` | finally 释放会话、onWait/shouldCancel 接线、guidance、audit |
| `src/config.ts` | 6 个新配置项 |
| `src/server.ts` | /metrics 追加 ziniao 指标（或经 gate 快照） |
| `remote/ziniao-worker-win.mjs`、`remote/ziniao-worker.mjs` | 机器锁 |
| `scripts/ziniao-worker-lock-smoke.mjs` | 新增 |
| `tests/ziniao-gate.test.ts`、`tests/ziniao-tool.test.ts`、`tests/orchestrator.test.ts` | 新增/更新 |
| `docs/operations.md`、`README.md`、`skills/ziniao-shared/SKILL.md` | 文档与 skill 指引 |
