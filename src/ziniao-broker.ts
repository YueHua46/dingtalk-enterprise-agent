import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import {
  DEFAULT_ZINIAO_OP_MAX_MS,
  ZiniaoGate,
  ZINIAO_LEASE_LOST,
  type ZiniaoGateMetrics,
  type ZiniaoGateRequest,
  type ZiniaoGateWaitInfo,
  type ZiniaoGateSnapshot,
  type ZiniaoLeaseHandle,
  type ZiniaoOp
} from './ziniao-gate.js';
import { ZINIAO_BRIDGE_NAMESPACES, ZINIAO_INTERLEAVE_READ_CAPABILITIES } from './ziniao-policy.js';

const execFileAsync = promisify(execFile);
const authUrlPattern = /https:\/\/open\.ziniao\.com\/memberAuth\?[^\s"'<>]+/;
export const ZINIAO_AUTH_INIT_FAILED = 'ZINIAO_AUTH_INIT_FAILED';
export const ZINIAO_LOCAL_CLIENT_REQUIRED = 'ZINIAO_LOCAL_CLIENT_REQUIRED';

const GATE_RESOURCE = 'ziniao-executor-1';

export type ZiniaoBrokerConfig = Pick<Config, 'ZINIAO_BIN' | 'ZINIAO_USERS_DIR'> &
  Partial<Pick<Config, 'ZINIAO_GATE_MAX_WAIT_MS' | 'ZINIAO_GATE_MAX_WAITERS' | 'ZINIAO_SESSION_IDLE_MS' | 'ZINIAO_SESSION_MAX_MS' | 'ZINIAO_INTERLEAVE_READS' | 'ZINIAO_GATE_DISABLED'>>;

export interface ZiniaoRunOptions {
  taskId?: string;
  shouldCancel?: () => boolean;
  onWait?: (info: ZiniaoGateWaitInfo) => void;
  onAcquired?: (info: { depth: number; waitedMs: number }) => void;
}

export interface ZiniaoAuthSession {
  prompt: string;
  completion: Promise<void>;
  cancel: () => void;
}

export class ZiniaoBroker {
  private readonly gate: ZiniaoGate;
  private readonly sessions = new Map<string, { handle: ZiniaoLeaseHandle }>();

  public constructor(protected readonly config: ZiniaoBrokerConfig) {
    this.gate = new ZiniaoGate({
      maxWaitMs: config.ZINIAO_GATE_MAX_WAIT_MS ?? 15 * 60_000,
      maxWaiters: config.ZINIAO_GATE_MAX_WAITERS ?? 20,
      sessionIdleMs: config.ZINIAO_SESSION_IDLE_MS ?? 3 * 60_000,
      sessionMaxMs: config.ZINIAO_SESSION_MAX_MS ?? 30 * 60_000,
      opMaxMs: DEFAULT_ZINIAO_OP_MAX_MS,
      readLane: config.ZINIAO_INTERLEAVE_READS === 'true'
    });
  }

  public userHome(user: UserIdentity): string {
    const digest = createHash('sha256').update(JSON.stringify([user.corpId, user.userId])).digest('hex');
    return resolve(this.config.ZINIAO_USERS_DIR, digest);
  }

  private environment(user: UserIdentity): NodeJS.ProcessEnv {
    const home = this.userHome(user);
    const inherited: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'SystemRoot', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE'] as const) {
      if (process.env[key] !== undefined) inherited[key] = process.env[key];
    }
    return {
      ...inherited,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CACHE_HOME: join(home, '.cache'),
      ZINIAO_CLI_NO_UPDATE_CHECK: '1'
    };
  }

  // ---- gated public surface ----------------------------------------------

  public async status(user: UserIdentity, opts: ZiniaoRunOptions = {}): Promise<{ profileKey: string } | null> {
    return this.gated(user, { op: 'status', ...opts }, () => this.statusRaw(user));
  }

  public async runCommand(user: UserIdentity, args: string[], opts: ZiniaoRunOptions = {}): Promise<unknown> {
    const namespace = args[0]!;
    if (ZINIAO_BRIDGE_NAMESPACES.has(namespace)) return this.runBridgeCommand(user, args, opts);
    return this.gated(user, { op: 'run', readOnly: this.isReadOnlyCapability(args), ...opts }, () => this.runRaw(user, args));
  }

  public async beginAuthorization(user: UserIdentity, opts: ZiniaoRunOptions = {}): Promise<ZiniaoAuthSession> {
    if (this.gateDisabled()) return this.beginAuthorizationRaw(user);
    // The whole authorization (config init, browser approval, key save) holds
    // the executor: officially it is a CLI usage like any other.
    const handle = await this.gate.acquire(GATE_RESOURCE, this.gateRequest(user, { op: 'authorize', ...opts }), 'call');
    try {
      const session = await this.beginAuthorizationRaw(user);
      // The caller needs the prompt immediately; the lease is released only
      // when the authorization settles (or the hard cap cancels the CLI).
      void session.completion.catch(() => undefined).then(() => handle.release());
      void handle.lost.catch(() => session.cancel());
      return session;
    } catch (error) {
      handle.release();
      throw error;
    }
  }

  /** Releases the caller's bridge session lease (task end, cancel, re-auth). */
  public async endSession(user: UserIdentity): Promise<void> {
    const key = this.userKey(user);
    const entry = this.sessions.get(key);
    if (!entry) return;
    this.sessions.delete(key);
    entry.handle.release();
  }

  /** In-process queue snapshot for utility.queue-status (no CLI, no lock). */
  public queueStatus(user: UserIdentity): ZiniaoGateSnapshot {
    return this.gate.snapshot(GATE_RESOURCE, this.userKey(user));
  }

  public gateMetrics(): ZiniaoGateMetrics {
    return this.gate.metrics(GATE_RESOURCE);
  }

  // ---- lane selection ------------------------------------------------------

  private gated<T>(user: UserIdentity, opts: ZiniaoRunOptions & { op: ZiniaoOp; readOnly?: boolean }, fn: () => Promise<T>): Promise<T> {
    if (this.gateDisabled()) return fn();
    return this.gate.withLease(GATE_RESOURCE, this.gateRequest(user, opts), fn);
  }

  private async runBridgeCommand(user: UserIdentity, args: string[], opts: ZiniaoRunOptions): Promise<unknown> {
    if (this.gateDisabled()) return this.runRaw(user, args);
    const key = this.userKey(user);
    let entry = this.sessions.get(key);
    if (entry?.handle.isLost()) {
      // Hard session cap: force a clean task restart instead of silently
      // continuing on an unknown browser state.
      this.sessions.delete(key);
      throw new Error(ZINIAO_LEASE_LOST);
    }
    if (entry?.handle.isExpired()) {
      // Idle TTL: other users may have used the executor meanwhile. The skill
      // guidance tells the model to re-open stores after regaining access.
      this.sessions.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const handle = await this.gate.acquireSession(GATE_RESOURCE, this.gateRequest(user, { op: 'run', ...opts }));
      entry = { handle };
      this.sessions.set(key, entry);
    } else {
      entry.handle.touch();
    }
    return this.gate.runExclusive(GATE_RESOURCE, this.gateRequest(user, { op: 'run', ...opts }), () => this.runRaw(user, args));
  }

  private isReadOnlyCapability(args: string[]): boolean {
    if (args.length < 2) return false;
    return ZINIAO_INTERLEAVE_READ_CAPABILITIES.has(args[0]! + '.' + args[1]!);
  }

  private gateRequest(user: UserIdentity, opts: ZiniaoRunOptions & { op: ZiniaoOp; readOnly?: boolean }): ZiniaoGateRequest {
    const request: ZiniaoGateRequest = { userKey: this.userKey(user), op: opts.op };
    if (opts.taskId !== undefined) request.taskId = opts.taskId;
    if (opts.readOnly !== undefined) request.readOnly = opts.readOnly;
    if (opts.shouldCancel !== undefined) request.shouldCancel = opts.shouldCancel;
    if (opts.onWait !== undefined) request.onWait = opts.onWait;
    if (opts.onAcquired !== undefined) request.onAcquired = opts.onAcquired;
    return request;
  }

  private gateDisabled(): boolean {
    return this.config.ZINIAO_GATE_DISABLED === 'true';
  }

  private userKey(user: UserIdentity): string {
    return user.corpId + ':' + user.userId;
  }

  // ---- raw implementations (no gating; overridable) ----------------------

  protected async statusRaw(user: UserIdentity): Promise<{ profileKey: string } | null> {
    const home = this.userHome(user);
    try {
      await stat(join(home, '.ziniao-cli', 'config.json'));
      try { await stat(join(home, '.ziniao-auth-invalid')); return null; } catch { /* no invalid marker */ }
    } catch {
      return null;
    }
    try {
      await execFileAsync(this.config.ZINIAO_BIN, ['config', 'show'], {
        env: this.environment(user), timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true
      });
      return { profileKey: this.profileKey(user) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/未找到配置|未配置|api.?key|credential|keychain|auth/i.test(message)) return null;
      throw new Error('ZINIAO_STATUS_FAILED');
    }
  }

  protected async beginAuthorizationRaw(user: UserIdentity): Promise<ZiniaoAuthSession> {
    const home = this.userHome(user);
    await mkdir(home, { recursive: true, mode: 0o700 });
    const child = spawn(this.config.ZINIAO_BIN, ['config', 'init', '--new', '--profile', this.profileKey(user)], {
      env: this.environment(user), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let output = '';
    let resolvePrompt!: (value: string) => void;
    let rejectPrompt!: (error: unknown) => void;
    let prompted = false;
    const prompt = new Promise<string>((resolve, reject) => { resolvePrompt = resolve; rejectPrompt = reject; });
    const inspect = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-8192);
      const url = output.match(authUrlPattern)?.[0];
      if (url && !prompted) { prompted = true; resolvePrompt('授权地址：' + url); }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    const exit = new Promise<void>((resolveExit, rejectExit) => {
      child.on('error', () => rejectExit(new Error(ZINIAO_AUTH_INIT_FAILED)));
      child.on('exit', (code) => {
        if (code === 0) return resolveExit();
        if (/紫鸟客户端未登录|启动并登录后再执行初始化/.test(output)) {
          return rejectExit(new Error(ZINIAO_LOCAL_CLIENT_REQUIRED));
        }
        rejectExit(new Error('ZINIAO_AUTH_FAILED: CLI exited ' + String(code)));
      });
    });
    const completion = exit.then(async () => {
      await unlink(join(home, '.ziniao-auth-invalid')).catch(() => undefined);
      if (!await this.statusRaw(user)) throw new Error('ZINIAO_AUTH_NOT_SAVED');
    });
    void completion.catch(() => undefined);
    const timer = setTimeout(() => {
      if (!prompted) rejectPrompt(new Error(ZINIAO_AUTH_INIT_FAILED));
    }, 20_000);
    let authPrompt: string;
    try {
      authPrompt = await Promise.race([prompt, exit.then(() => { throw new Error(ZINIAO_AUTH_INIT_FAILED); })]);
    } catch (error) {
      if (!child.killed) child.kill('SIGTERM');
      void completion.catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const deadline = setTimeout(() => { if (!child.killed) child.kill('SIGTERM'); }, 15 * 60 * 1000);
    return {
      prompt: authPrompt,
      completion: completion.finally(() => clearTimeout(deadline)),
      cancel: () => { if (!child.killed) child.kill('SIGTERM'); }
    };
  }

  protected async runRaw(user: UserIdentity, args: string[]): Promise<unknown> {
    if (!await this.statusRaw(user)) throw new Error('ZINIAO_AUTH_REQUIRED');
    let stdout: string;
    try {
      const result = await execFileAsync(this.config.ZINIAO_BIN, [...args, '--format', 'json'], {
        env: this.environment(user), timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
      });
      stdout = String(result.stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/需要\s*Boss|Boss\s*权限|permission denied|权限不足/i.test(message)) throw new Error('ZINIAO_PERMISSION_DENIED');
      if (/未找到配置|api.?key|credential|keychain|unauthori[sz]ed|auth/i.test(message)) {
        await this.markAuthInvalid(user);
        throw new Error('ZINIAO_AUTH_REQUIRED');
      }
      throw new Error('ZINIAO_COMMAND_FAILED');
    }
    let parsed: any;
    try { parsed = JSON.parse(stdout); } catch { throw new Error('ZINIAO_INVALID_RESPONSE'); }
    if (parsed?.ok === false) {
      const errorMessage = String(parsed.error?.message ?? 'unknown error');
      if (/需要\s*Boss|Boss\s*权限|permission denied|权限不足/i.test(errorMessage)) throw new Error('ZINIAO_PERMISSION_DENIED');
      if (parsed.error?.type === 'auth') {
        await this.markAuthInvalid(user);
        throw new Error('ZINIAO_AUTH_REQUIRED');
      }
      throw new Error('ZINIAO_COMMAND_FAILED: ' + errorMessage);
    }
    return parsed?.data ?? parsed;
  }

  protected profileKey(user: UserIdentity): string {
    return 'dingtalk-' + createHash('sha256').update(JSON.stringify([user.corpId, user.userId])).digest('hex').slice(0, 24);
  }

  protected async markAuthInvalid(user: UserIdentity): Promise<void> {
    await writeFile(join(this.userHome(user), '.ziniao-auth-invalid'), '', { mode: 0o600 });
  }
}
