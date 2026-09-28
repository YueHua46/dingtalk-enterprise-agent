import { describe, expect, it, vi } from 'vitest';
import {
  ZiniaoGate,
  ZINIAO_BUSY,
  ZINIAO_CANCELLED,
  ZINIAO_LEASE_LOST,
  ZINIAO_QUEUE_TIMEOUT,
  type ZiniaoGateRequest
} from '../src/ziniao-gate.js';

const R = 'executor';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeGate(overrides: Record<string, unknown> = {}): ZiniaoGate {
  return new ZiniaoGate({
    maxWaitMs: 2_000,
    maxWaiters: 3,
    sessionIdleMs: 10_000,
    sessionMaxMs: 30_000,
    opMaxMs: { status: 2_000, run: 2_000, authorize: 30_000 },
    pollIntervalMs: 10,
    waitNoticeMs: 20,
    ...overrides
  } as never);
}

function req(userKey: string, extra: Partial<ZiniaoGateRequest> = {}): ZiniaoGateRequest {
  return { userKey, op: 'run', ...extra };
}

describe('ZiniaoGate main lane', () => {
  it('grants the executor in strict FIFO order', async () => {
    const gate = makeGate();
    const order: string[] = [];
    const first = gate.withLease(R, req('a'), async () => { order.push('a'); await delay(60); });
    const second = gate.withLease(R, req('b'), async () => { order.push('b'); });
    const third = gate.withLease(R, req('c'), async () => { order.push('c'); });
    await Promise.all([first, second, third]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('rejects immediately when the queue is full', async () => {
    const gate = makeGate();
    const hold = gate.withLease(R, req('a'), () => delay(80));
    const queued = [req('b'), req('c'), req('d')].map((r) => gate.withLease(R, r, async () => undefined));
    const overflow = gate.withLease(R, req('e'), async () => undefined);
    await expect(overflow).rejects.toThrow(ZINIAO_BUSY);
    await hold;
    await Promise.all(queued);
  });

  it('times out waiters past maxWaitMs', async () => {
    const gate = makeGate({ maxWaitMs: 80 });
    const hold = gate.withLease(R, req('a'), () => delay(400));
    const victim = gate.withLease(R, req('b'), async () => undefined);
    await expect(victim).rejects.toThrow(ZINIAO_QUEUE_TIMEOUT);
    await hold;
  });

  it('removes cancelled waiters from the queue within the poll interval', async () => {
    const gate = makeGate({ maxWaitMs: 10_000 });
    const hold = gate.withLease(R, req('a'), () => delay(200));
    let cancelled = false;
    const victim = gate.withLease(R, req('b', { shouldCancel: () => cancelled }), async () => undefined);
    await delay(40);
    cancelled = true;
    await expect(victim).rejects.toThrow(ZINIAO_CANCELLED);
    expect(gate.metrics(R).queueDepth).toBe(0);
    await hold;
  });

  it('force-releases a call lease past the op cap and reports the loss', async () => {
    const gate = makeGate({ opMaxMs: { status: 80, run: 80, authorize: 30_000 } });
    const slow = gate.withLease(R, req('a'), () => delay(200));
    await expect(slow).rejects.toThrow(ZINIAO_LEASE_LOST);
    // Let the force-released holder's fn fully settle so the process lane is
    // free before the next grant.
    await delay(300);
    const next = gate.withLease(R, req('b'), async () => 'ok');
    await expect(next).resolves.toBe('ok');
  });
});

describe('ZiniaoGate session lease', () => {
  it('blocks other users until the session is released', async () => {
    const gate = makeGate();
    const session = await gate.acquireSession(R, req('a'));
    let done = false;
    const blocked = gate.withLease(R, req('b'), async () => { done = true; });
    await delay(60);
    expect(done).toBe(false);
    session.release();
    await blocked;
    expect(done).toBe(true);
  });

  it('expires the session after the idle TTL and re-grants waiting users', async () => {
    const gate = makeGate({ sessionIdleMs: 100 });
    const session = await gate.acquireSession(R, req('a'));
    const blocked = gate.withLease(R, req('b'), async () => 'b');
    session.touch();
    await delay(60);
    session.touch();
    await delay(180);
    await expect(blocked).resolves.toBe('b');
    expect(session.isExpired()).toBe(true);
  });

  it('force-releases a session past the hard cap and marks it lost', async () => {
    const gate = makeGate({ sessionMaxMs: 100 });
    const session = await gate.acquireSession(R, req('a'));
    await delay(200);
    expect(session.isLost()).toBe(true);
    const next = gate.withLease(R, req('b'), async () => 'b');
    await expect(next).resolves.toBe('b');
  });

  it('lets a session run several process-exclusive calls in sequence', async () => {
    const gate = makeGate();
    const session = await gate.acquireSession(R, req('a'));
    const calls: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      session.touch();
      await gate.runExclusive(R, req('a'), async () => { calls.push(index); await delay(10); });
    }
    session.release();
    expect(calls).toEqual([0, 1, 2]);
  });
});

describe('ZiniaoGate observability and interleave lane', () => {
  it('reports position and depth without exposing other users', async () => {
    const gate = makeGate();
    const waits: Array<{ position: number; depth: number; waitedMs: number }> = [];
    const hold = gate.withLease(R, req('a'), () => delay(120));
    const victim = gate.withLease(R, req('b', { onWait: (info) => waits.push(info) }), async () => undefined);
    const snapshot = gate.snapshot(R, 'b');
    expect(snapshot.busy).toBe(true);
    expect(snapshot.heldByMe).toBe(false);
    expect(snapshot.depth).toBe(1);
    expect(snapshot.holder).toMatchObject({ op: 'run', kind: 'call' });
    expect(JSON.stringify(snapshot)).not.toContain('"a"');
    await hold;
    await victim;
    expect(waits[0]).toMatchObject({ position: 1, depth: 1, waitedMs: 0 });
    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect(gate.snapshot(R, 'b').busy).toBe(false);
  });

  it('keeps read-only calls queued behind a foreign session in strict mode', async () => {
    const gate = makeGate();
    const session = await gate.acquireSession(R, req('a'));
    let done = false;
    const read = gate.withLease(R, req('b', { readOnly: true }), async () => { done = true; });
    await delay(60);
    expect(done).toBe(false);
    session.release();
    await read;
    expect(done).toBe(true);
  });

  it('lets read-only calls borrow the process lane during a foreign session in interleave mode', async () => {
    const gate = makeGate({ readLane: true, readLaneMaxWaitMs: 1_000 });
    const session = await gate.acquireSession(R, req('a'));
    const read = gate.withLease(R, req('b', { readOnly: true }), async () => 'read-ok');
    await expect(read).resolves.toBe('read-ok');
    // A write still waits for the session even in interleave mode.
    let writeDone = false;
    const write = gate.withLease(R, req('b'), async () => { writeDone = true; });
    await delay(40);
    expect(writeDone).toBe(false);
    session.release();
    await write;
    expect(writeDone).toBe(true);
  });

  it('still never overlaps two process-lane executions in interleave mode', async () => {
    const gate = makeGate({ readLane: true, readLaneMaxWaitMs: 5_000 });
    const session = await gate.acquireSession(R, req('a'));
    let running = 0;
    let maxRunning = 0;
    const track = async (ms: number) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await delay(ms);
      running -= 1;
    };
    const tasks = [
      gate.runExclusive(R, req('a'), () => track(30)),
      gate.withLease(R, req('b', { readOnly: true }), () => track(10)),
      gate.withLease(R, req('c', { readOnly: true }), () => track(10)),
      gate.withLease(R, req('d', { readOnly: true }), () => track(10))
    ];
    await Promise.all(tasks);
    session.release();
    expect(maxRunning).toBe(1);
  });
});
