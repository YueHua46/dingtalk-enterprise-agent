import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import type { AgentRequest } from '../src/types.js';

const config = loadConfig({
  NODE_ENV: 'production', TASK_WORKFLOW_MODE: 'enforce', DINGTALK_ROBOT_CODE: 'robot', DINGTALK_CLIENT_ID: 'id',
  DINGTALK_CLIENT_SECRET: 'secret', DWS_BOT_PROFILE: 'bot', MODEL_BASE_URL: 'https://model.example/v1',
  MODEL_API_KEY: 'model-key', CLAMAV_HOST: 'clamav', INTERNAL_API_TOKEN: 'x'.repeat(32)
});

const request: AgentRequest = {
  requestId: 'sandbox', messageId: 'sandbox', user: { corpId: 'corp', userId: 'user-1' },
  surface: { type: 'group', id: 'group-1' }, text: '最近7天日本站的总销量是多少？', attachments: [], receivedAt: Date.now()
};
const call = (namespace: string, tool: string, args: unknown) => ({ method: 'item/tool/call', params: { namespace, tool, arguments: args } });

describe('sandbox evidence', () => {
  it('saves full results as readable files with an index and passes computations to the verifier', async () => {
    const files = new Map<string, string>();
    let toolText = '';
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      interrupt: vi.fn(async () => undefined),
      usesWorker: () => true,
      writeEvidence: vi.fn(async (_task: string, name: string, content: string) => { files.set(name, content); return `evidence/${name}`; }),
      runPython: vi.fn(async () => ({ exitCode: 0, stdout: 'units=35', stderr: '', timedOut: false })),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        const query = await onTool(call('crossborderops', 'query', { dataset: 'daily.metrics', params: { site: 'JP' } }));
        toolText = query.contentItems.map((item: { text: string }) => item.text).join('\n');
        const computed = await onTool(call('analysis', 'python', { code: 'print("units=35")', purpose: '合计销量' }));
        expect(computed.success).toBe(true);
        return { text: '日本站合计 35 件', threadId: 'thread-1' };
      })
    };
    const repo = new InMemoryRepository();
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, { async send() { /* captured elsewhere */ } });
    vi.spyOn((orchestrator as any).crossBorderOpsTool, 'execute').mockResolvedValue({ dataset: 'daily.metrics', data: { rows: 'x'.repeat(70_000) }, scope: {}, evidence: {} });
    const review = vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ status: 'pass', issues: [], reason: 'ok' });
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect([...files.keys()]).toEqual(['01_crossborderops.daily.metrics.json', 'index.json']);
    expect(JSON.parse(files.get('index.json')!)[0]).toMatchObject({ file: '01_crossborderops.daily.metrics.json', capabilityId: 'crossborderops.daily.metrics' });
    expect(files.get('01_crossborderops.daily.metrics.json')!.length).toBeGreaterThan(70_000);
    expect(toolText).toContain('evidence/01_crossborderops.daily.metrics.json');
    expect(toolText).toContain('已截断显示');
    const input = review.mock.calls[0]![0] as { excerpts: Record<string, string>; computeAvailable: boolean };
    expect(input.computeAvailable).toBe(true);
    expect(Object.values(input.excerpts).some((text) => text.includes('units=35') && text.includes('合计销量'))).toBe(true);
    await orchestrator.stop();
  });

  it('reports the computation runtime as unavailable outside the sandbox', async () => {
    let reply: any;
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      interrupt: vi.fn(async () => undefined),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        reply = await onTool(call('analysis', 'python', { code: 'print(1)' }));
        return { text: '答复', threadId: 'thread-1' };
      })
    };
    const repo = new InMemoryRepository();
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, { async send() { /* noop */ } });
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ status: 'pass', issues: [], reason: 'ok' });
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(reply.success).toBe(false);
    expect(reply.contentItems[0].text).toContain('ANALYSIS_RUNTIME_UNAVAILABLE');
    await orchestrator.stop();
  });
});
