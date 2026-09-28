// Global FIFO gate for the ziniao execution machine.
//
// Ziniao officially supports switching between accounts but not calling the
// CLI with two accounts at the same time, and the ZClaw Bridge exposes a
// single browser environment. The gate therefore serializes every ziniao
// operation across all DingTalk users on two levels:
//
// - Main lane (session exclusivity): a "call" hold wraps one status/run/
//   authorize operation; a "session" hold spans a whole bridge workflow
//   (store open -> page screenshot -> store close) so no other user can
//   interleave browser commands between two calls of one task.
// - Process lane (process exclusivity): every actual CLI invocation runs
//   exclusively, including calls made inside an active session. This is the
//   invariant the machine-level lock in the workers also enforces.
//
// With ZINIAO_INTERLEAVE_READS=true (reserved; requires written confirmation
// from ziniao), read-only server-API commands marked readOnly may use the
// process lane directly while another user's session holds the main lane, so
// a 2s account.list does not wait behind a 15-minute patrol. The default is
// strict full serialization: everything waits in the main lane.

export type ZiniaoOp = 'status' | 'run' | 'authorize';
export type ZiniaoHoldKind = 'call' | 'session';

export const ZINIAO_BUSY = 'ZINIAO_BUSY';
export const ZINIAO_QUEUE_TIMEOUT = 'ZINIAO_QUEUE_TIMEOUT';
export const ZINIAO_CANCELLED = 'ZINIAO_CANCELLED';
export const ZINIAO_LEASE_LOST = 'ZINIAO_GATE_LEASE_LOST';

export interface ZiniaoGateWaitInfo {
  position: number;
  depth: number;
  waitedMs: number;
}

export interface ZiniaoGateRequest {
  userKey: string;
  taskId?: string;
  op: ZiniaoOp;
  /** Marks an explicit read-only server-API command (interleave mode only). */
  readOnly?: boolean;
  shouldCancel?: () => boolean;
  onWait?: (info: ZiniaoGateWaitInfo) => void;
  onAcquired?: (info: { depth: number; waitedMs: number }) => void;
}

export interface ZiniaoGateSnapshot {
  busy: boolean;
  heldByMe: boolean;
  position: number | null;
  depth: number;
  holder: { op: ZiniaoOp; kind: ZiniaoHoldKind; heldMs: number } | null;
}

export interface ZiniaoGateMetrics {
  queueDepth: number;
  busy: boolean;
  holderHeldMs: number;
  busyTotal: number;
  queueTimeoutTotal: number;
  cancelledTotal: number;
  leaseLostTotal: number;
  sessionExpiredTotal: number;
}

export interface ZiniaoLeaseHandle {
  touch(): void;
  release(): void;
  isLost(): boolean;
  isExpired(): boolean;
  /** Rejects with ZINIAO_LEASE_LOST when a hard cap force-releases this lease. */
  readonly lost: Promise<never>;
}

export interface ZiniaoGateOptions {
  maxWaitMs: number;
  maxWaiters: number;
  sessionIdleMs: number;
  sessionMaxMs: number;
  opMaxMs: Record<ZiniaoOp, number>;
  /** Reserved: allow read-only server-API calls to bypass another user's session. */
  readLane?: boolean;
  readLaneMaxWaitMs?: number;
  /** Cancellation poll interval (ms). */
  pollIntervalMs?: number;
  /** Queue position refresh interval (ms). */
  waitNoticeMs?: number;
}

export const DEFAULT_ZINIAO_OP_MAX_MS: Record<ZiniaoOp, number> = {
  status: 30_000,
  run: 90_000,
  authorize: 18 * 60_000
};

interface Waiter {
  req: ZiniaoGateRequest;
  kind: ZiniaoHoldKind;
  op: ZiniaoOp;
  enqueuedAt: number;
  timer?: NodeJS.Timeout;
  poll?: NodeJS.Timeout;
  progress?: NodeJS.Timeout;
  resolve: (handle: ZiniaoLeaseHandle) => void;
  reject: (error: Error) => void;
  settled: boolean;
}

interface Holder {
  req: ZiniaoGateRequest;
  kind: ZiniaoHoldKind;
  op: ZiniaoOp;
  acquiredAt: number;
  lastTouchAt: number;
  lost: boolean;
  expired: boolean;
  released: boolean;
  handle?: ZiniaoLeaseHandle;
  idleTimer?: NodeJS.Timeout;
  capTimer?: NodeJS.Timeout;
}

interface ProcessWaiter {
  req: ZiniaoGateRequest;
  timer?: NodeJS.Timeout;
  poll?: NodeJS.Timeout;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
}

class ResourceState {
  public holder: Holder | null = null;
  public cliRunning = false;
  public queue: Waiter[] = [];
  public processQueue: ProcessWaiter[] = [];
  public readonly counters = {
    busyTotal: 0,
    queueTimeoutTotal: 0,
    cancelledTotal: 0,
    leaseLostTotal: 0,
    sessionExpiredTotal: 0
  };
}

export class ZiniaoGate {
  private readonly resources = new Map<string, ResourceState>();
  private readonly pollIntervalMs: number;
  private readonly waitNoticeMs: number;

  public constructor(private readonly options: ZiniaoGateOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.waitNoticeMs = options.waitNoticeMs ?? 30_000;
  }

  /**
   * Main-lane one-shot operation: wait for session exclusivity, run `fn` with
   * process exclusivity, release. Rejects with ZINIAO_LEASE_LOST if the
   * op-specific hard cap force-releases the lease while `fn` is pending.
   */
  public async withLease<T>(resource: string, req: ZiniaoGateRequest, fn: () => Promise<T>): Promise<T> {
    if (this.readBypassEligible(resource, req)) {
      // Reserved interleave mode: the session holder keeps the main lane, the
      // read only borrows the process lane between the holder's CLI calls.
      return this.runExclusive(resource, req, fn, this.options.readLaneMaxWaitMs ?? 30_000);
    }
    const handle = await this.acquire(resource, req, 'call');
    try {
      const background = this.runExclusive(resource, req, fn);
      const raced = await Promise.race([background, handle.lost]);
      // Keep the process slot reserved until `fn` really settles, even when a
      // cap already rejected this caller.
      await background.catch(() => undefined);
      return raced;
    } finally {
      handle.release();
    }
  }

  /**
   * Main-lane session hold for bridge workflows. The caller keeps the lease
   * across multiple CLI invocations (touch between calls) and releases it at
   * task end. Idle TTL and sessionMaxMs are enforced by the gate.
   */
  public async acquireSession(resource: string, req: ZiniaoGateRequest): Promise<ZiniaoLeaseHandle> {
    return this.acquire(resource, req, 'session');
  }

  /** Run `fn` with process exclusivity only. Used inside an active session. */
  public async runExclusive<T>(resource: string, req: ZiniaoGateRequest, fn: () => Promise<T>, maxWaitMs?: number): Promise<T> {
    await this.processAcquire(resource, req, maxWaitMs ?? this.options.maxWaitMs);
    try {
      return await fn();
    } finally {
      this.processRelease(resource);
    }
  }

  public snapshot(resource: string, userKey: string): ZiniaoGateSnapshot {
    const state = this.state(resource);
    const holder = state.holder;
    return {
      busy: holder !== null || state.cliRunning,
      heldByMe: holder?.req.userKey === userKey,
      position: null,
      depth: state.queue.length,
      holder: holder ? { op: holder.op, kind: holder.kind, heldMs: Date.now() - holder.acquiredAt } : null
    };
  }

  public metrics(resource: string): ZiniaoGateMetrics {
    const state = this.state(resource);
    return {
      queueDepth: state.queue.length,
      busy: state.holder !== null || state.cliRunning,
      holderHeldMs: state.holder ? Date.now() - state.holder.acquiredAt : 0,
      ...state.counters
    };
  }

  // ---- main lane ---------------------------------------------------------

  private readBypassEligible(resource: string, req: ZiniaoGateRequest): boolean {
    if (!this.options.readLane || !req.readOnly || req.op !== 'run') return false;
    const holder = this.state(resource).holder;
    return holder?.kind === 'session' && holder.req.userKey !== req.userKey;
  }

  /**
   * Main-lane hold without running anything. Used by long-lived flows that
   * must release on their own lifecycle (authorization settles, session ends).
   */
  public async acquire(resource: string, req: ZiniaoGateRequest, kind: ZiniaoHoldKind): Promise<ZiniaoLeaseHandle> {
    const state = this.state(resource);
    // Same-user session re-entry: the previous bridge command may not have
    // registered its lease in the caller's bookkeeping yet (microtask
    // ordering). Queueing again would deadlock the user against their own
    // session, so return the live lease instead.
    if (kind === 'session') {
      const holder = state.holder;
      if (holder && holder.kind === 'session' && holder.req.userKey === req.userKey &&
          !holder.lost && !holder.expired && !holder.released && holder.handle) {
        holder.handle.touch();
        return holder.handle;
      }
    }
    if (state.queue.length >= this.options.maxWaiters) {
      state.counters.busyTotal += 1;
      throw new Error(ZINIAO_BUSY);
    }
    return new Promise<ZiniaoLeaseHandle>((resolve, reject) => {
      const waiter: Waiter = {
        req, kind, op: req.op,
        enqueuedAt: Date.now(),
        resolve, reject, settled: false
      };
      waiter.timer = setTimeout(() => this.settleWaiter(resource, waiter, new Error(ZINIAO_QUEUE_TIMEOUT)), this.options.maxWaitMs);
      waiter.timer.unref();
      waiter.poll = setInterval(() => {
        if (waiter.req.shouldCancel?.()) {
          this.settleWaiter(resource, waiter, new Error(ZINIAO_CANCELLED));
        }
      }, this.pollIntervalMs);
      waiter.poll.unref();
      waiter.progress = setInterval(() => {
        if (waiter.settled) return;
        const position = state.queue.indexOf(waiter) + 1;
        if (position > 0) {
          waiter.req.onWait?.({
            position,
            depth: state.queue.length,
            waitedMs: Date.now() - waiter.enqueuedAt
          });
        }
      }, this.waitNoticeMs);
      waiter.progress.unref();
      state.queue.push(waiter);
      waiter.req.onWait?.({
        position: state.queue.length,
        depth: state.queue.length,
        waitedMs: 0
      });
      this.tryGrant(resource);
    });
  }

  private tryGrant(resource: string): void {
    const state = this.state(resource);
    while (!state.holder && state.queue.length > 0) {
      const waiter = state.queue.shift()!;
      if (waiter.settled) continue;
      clearTimeout(waiter.timer);
      clearInterval(waiter.poll);
      clearInterval(waiter.progress);
      waiter.settled = true;

      let lostResolve!: () => void;
      const lost = new Promise<never>((_, reject) => {
        lostResolve = () => reject(new Error(ZINIAO_LEASE_LOST));
      });
      lost.catch(() => undefined); // never leave a cap rejection unhandled

      const holder: Holder = {
        req: waiter.req,
        kind: waiter.kind,
        op: waiter.op,
        acquiredAt: Date.now(),
        lastTouchAt: Date.now(),
        lost: false,
        expired: false,
        released: false
      };
      state.holder = holder;

      const forceRelease = (asLost: boolean) => {
        if (holder.released || holder.lost || holder.expired) return;
        if (asLost) {
          holder.lost = true;
          state.counters.leaseLostTotal += 1;
          lostResolve();
        } else {
          holder.expired = true;
          state.counters.sessionExpiredTotal += 1;
        }
        this.clearHolderTimers(holder);
        if (state.holder === holder) state.holder = null;
        this.tryGrant(resource);
      };

      if (waiter.kind === 'session') {
        holder.idleTimer = setTimeout(() => forceRelease(false), this.options.sessionIdleMs);
        holder.idleTimer.unref();
        holder.capTimer = setTimeout(() => forceRelease(true), this.options.sessionMaxMs);
        holder.capTimer.unref();
      } else {
        holder.capTimer = setTimeout(() => forceRelease(true), this.options.opMaxMs[waiter.op] ?? DEFAULT_ZINIAO_OP_MAX_MS[waiter.op]);
        holder.capTimer.unref();
      }

      const handle: ZiniaoLeaseHandle = {
        touch: () => {
          if (holder.released || holder.lost || holder.expired) return;
          holder.lastTouchAt = Date.now();
          holder.idleTimer?.refresh();
        },
        release: () => {
          if (holder.released || holder.lost || holder.expired) return;
          holder.released = true;
          this.clearHolderTimers(holder);
          if (state.holder === holder) {
            state.holder = null;
            this.tryGrant(resource);
          }
        },
        isLost: () => holder.lost,
        isExpired: () => holder.expired,
        lost
      };
      waiter.resolve(handle);
      holder.handle = handle;
      waiter.req.onAcquired?.({ depth: state.queue.length, waitedMs: Date.now() - waiter.enqueuedAt });
      return;
    }
  }

  private settleWaiter(resource: string, waiter: Waiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    clearInterval(waiter.poll);
    clearInterval(waiter.progress);
    const state = this.state(resource);
    const index = state.queue.indexOf(waiter);
    if (index >= 0) state.queue.splice(index, 1);
    if (error.message === ZINIAO_QUEUE_TIMEOUT) state.counters.queueTimeoutTotal += 1;
    if (error.message === ZINIAO_CANCELLED) state.counters.cancelledTotal += 1;
    waiter.reject(error);
  }

  private clearHolderTimers(holder: Holder): void {
    if (holder.idleTimer) clearTimeout(holder.idleTimer);
    if (holder.capTimer) clearTimeout(holder.capTimer);
  }

  // ---- process lane ------------------------------------------------------

  private processAcquire(resource: string, req: ZiniaoGateRequest, maxWaitMs = this.options.maxWaitMs): Promise<void> {
    const state = this.state(resource);
    if (!state.cliRunning && state.processQueue.length === 0) {
      state.cliRunning = true;
      return Promise.resolve();
    }
    if (state.processQueue.length >= this.options.maxWaiters) {
      state.counters.busyTotal += 1;
      return Promise.reject(new Error(ZINIAO_BUSY));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: ProcessWaiter = {
        req,
        resolve, reject, settled: false
      };
      waiter.timer = setTimeout(() => this.settleProcessWaiter(resource, waiter, new Error(ZINIAO_BUSY)), maxWaitMs);
      waiter.timer.unref();
      waiter.poll = setInterval(() => {
        if (waiter.req.shouldCancel?.()) {
          this.settleProcessWaiter(resource, waiter, new Error(ZINIAO_CANCELLED));
        }
      }, this.pollIntervalMs);
      waiter.poll.unref();
      state.processQueue.push(waiter);
    });
  }

  private processRelease(resource: string): void {
    const state = this.state(resource);
    const next = state.processQueue.shift();
    if (next && !next.settled) {
      next.settled = true;
      clearTimeout(next.timer);
      clearInterval(next.poll);
      next.resolve();
      return;
    }
    state.cliRunning = false;
    this.tryGrant(resource);
  }

  private settleProcessWaiter(resource: string, waiter: ProcessWaiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    clearInterval(waiter.poll);
    const state = this.state(resource);
    const index = state.processQueue.indexOf(waiter);
    if (index >= 0) state.processQueue.splice(index, 1);
    if (error.message === ZINIAO_CANCELLED) state.counters.cancelledTotal += 1;
    waiter.reject(error);
  }

  private state(resource: string): ResourceState {
    let state = this.resources.get(resource);
    if (!state) {
      state = new ResourceState();
      this.resources.set(resource, state);
    }
    return state;
  }
}
