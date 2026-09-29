import { describe, expect, it, vi } from 'vitest';
import type { UserIdentity } from '../src/types.js';
import { parseZiniaoSuccessOutput, ZiniaoBroker, type ZiniaoAuthSession } from '../src/ziniao-broker.js';

const userA: UserIdentity = { corpId: 'corp-1', userId: 'user-a' };
const userB: UserIdentity = { corpId: 'corp-1', userId: 'user-b' };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class TestBroker extends ZiniaoBroker {
  public readonly runs: Array<{ user: string; args: string; at: number }> = [];
  private authCompletion?: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };

  protected override async statusRaw(): Promise<{ profileKey: string }> {
    return { profileKey: 'profile' };
  }

  protected override async runRaw(user: UserIdentity, args: string[]): Promise<unknown> {
    this.runs.push({ user: user.userId, args: args.slice(0, 2).join(' '), at: Date.now() });
    await delay(25);
    return { ok: true };
  }

  protected override async beginAuthorizationRaw(): Promise<ZiniaoAuthSession> {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    this.authCompletion = { promise, resolve, reject };
    return { prompt: '授权地址：https://open.ziniao.com/memberAuth?cliRequestId=test', completion: promise, cancel: () => reject(new Error('cancelled')) };
  }

  public completeAuthorization(): void {
    this.authCompletion?.resolve();
  }
}

const baseConfig = { ZINIAO_BIN: 'ziniao-cli', ZINIAO_USERS_DIR: './data/ziniao/users' } as const;

describe('Ziniao CLI output normalization', () => {
  it('accepts JSON, plain text and empty successful output', () => {
    expect(parseZiniaoSuccessOutput('{"ok":true,"data":{"storeId":"1"}}')).toEqual({ storeId: '1' });
    expect(parseZiniaoSuccessOutput('店铺已关闭')).toEqual({ message: '店铺已关闭' });
    expect(parseZiniaoSuccessOutput('  \r\n')).toBeNull();
  });

  it('preserves a structured CLI error envelope for classification', () => {
    expect(parseZiniaoSuccessOutput('{"ok":false,"error":{"type":"business","message":"failed"}}')).toEqual({
      ok: false, error: { type: 'business', message: 'failed' }
    });
  });
});

describe('ZiniaoBroker serialization', () => {
  it('holds one bridge session across commands so foreign users cannot interleave', async () => {
    const broker = new TestBroker(baseConfig);
    const a1 = broker.runCommand(userA, ['store', 'open', '--id', '1']);
    const b1 = broker.runCommand(userB, ['account', 'list']);
    const a2 = broker.runCommand(userA, ['page', 'screenshot', '--store-id', '1']);
    await Promise.all([a1, a2]);
    // B's strict call is still queued behind A's session even though A's
    // individual CLI calls have finished.
    expect(broker.runs.map((run) => run.user)).toEqual(['user-a', 'user-a']);
    await broker.endSession(userA);
    await b1;
    expect(broker.runs.map((run) => run.user)).toEqual(['user-a', 'user-a', 'user-b']);
  });

  it('releases the executor as soon as the bridge session ends', async () => {
    const broker = new TestBroker(baseConfig);
    const a1 = broker.runCommand(userA, ['store', 'list']);
    await a1;
    await broker.endSession(userA);
    const b1 = broker.runCommand(userB, ['store', 'list']);
    await b1;
    expect(broker.runs.map((run) => run.user)).toEqual(['user-a', 'user-b']);
  });

  it('lets a bridge session check its own authorization and call the server API', async () => {
    const broker = new TestBroker(baseConfig);
    await broker.runCommand(userA, ['store', 'list']);
    const foreign = broker.runCommand(userB, ['account', 'list']);
    expect(await broker.status(userA)).toEqual({ profileKey: 'profile' });
    await broker.runCommand(userA, ['account', 'list']);
    expect(broker.runs.map((run) => run.user)).toEqual(['user-a', 'user-a']);
    await broker.endSession(userA);
    await foreign;
    expect(broker.runs.map((run) => run.user)).toEqual(['user-a', 'user-a', 'user-b']);
  });

  it('keeps the executor occupied until an authorization settles', async () => {
    const broker = new TestBroker(baseConfig);
    let authSettled = false;
    let gotSession: ZiniaoAuthSession | undefined;
    const auth = broker.beginAuthorization(userA).then((session) => {
      gotSession = session;
      return session.completion.then(() => { authSettled = true; });
    });
    await vi.waitFor(() => expect(gotSession).toBeDefined(), { timeout: 1000, interval: 10 });
    const b1 = broker.runCommand(userB, ['account', 'list']);
    await delay(60);
    expect(broker.runs).toHaveLength(0);
    expect(authSettled).toBe(false);
    broker.completeAuthorization();
    await auth;
    await b1;
    expect(broker.runs.map((run) => run.user)).toEqual(['user-b']);
  });

  it('threads cancel and wait callbacks into the gate', async () => {
    const broker = new TestBroker(baseConfig);
    const onWait = vi.fn();
    const onAcquired = vi.fn();
    const first = broker.runCommand(userA, ['store', 'list'], { onWait, onAcquired });
    const second = broker.runCommand(userB, ['account', 'list'], { onWait, onAcquired });
    await first;
    await broker.endSession(userA);
    await second;
    expect(onWait).toHaveBeenCalled();
    expect(onAcquired).toHaveBeenCalled();
  });

  it('bypasses the gate when ZINIAO_GATE_DISABLED is set (emergency only)', async () => {
    const broker = new TestBroker({ ...baseConfig, ZINIAO_GATE_DISABLED: 'true' });
    const a = broker.runCommand(userA, ['store', 'list']);
    const b = broker.runCommand(userB, ['account', 'list']);
    await Promise.all([a, b]);
    expect(broker.runs).toHaveLength(2);
  });

  it('reports the queue snapshot for utility.queue-status without touching the CLI', async () => {
    const broker = new TestBroker(baseConfig);
    const hold = broker.runCommand(userA, ['store', 'list']);
    const queued = broker.runCommand(userB, ['account', 'list']);
    const snapshot = broker.queueStatus(userB);
    expect(snapshot.busy).toBe(true);
    expect(snapshot.heldByMe).toBe(false);
    expect(snapshot.depth).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('user-a');
    await hold;
    await broker.endSession(userA);
    await queued;
    expect(broker.queueStatus(userB).busy).toBe(false);
  });
});
