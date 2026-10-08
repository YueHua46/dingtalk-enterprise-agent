import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { A2uiTool, A2UI_CATALOG } from '../src/a2ui-tool.js';
import { DwsBroker } from '../src/dws-broker.js';
import { loadConfig } from './test-config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import type { CodexApprovalRequest, CodexClientLike } from '../src/codex-client.js';
import type { AgentRequest } from '../src/types.js';

const user = { corpId: 'corp', userId: 'member' };
const config = () => loadConfig({ DINGTALK_ROBOT_CODE: 'robot' });
const components = [{ id: 'root', component: 'Markdown', content: '查询结果' }];
const messages = [{ version: 'v1.0', createSurface: { surfaceId: 'task', catalogId: A2UI_CATALOG, dataModel: {} } },
  { version: 'v1.0', updateComponents: { surfaceId: 'task', components } }];

describe('A2UI display boundary', () => {
  it('builds reusable sections and host-owned surfaces without a template id', () => {
    const tool = new A2uiTool({} as DwsBroker);
    const input = tool.parse('show_sections', { title: '工作步骤', sections: [{ title: '第一步', markdown: '读取资料' }] });
    expect(tool.messages('host-task', input)[0]).toEqual({ version: 'v1.0', createSurface: { surfaceId: 'host-task', catalogId: A2UI_CATALOG, dataModel: {} } });
    expect(input.components[0]?.children).toEqual(['heading', 'panel0']);
  });

  it('rejects caller-controlled recipients, actions, functions and unsafe content', () => {
    const tool = new A2uiTool({} as DwsBroker);
    for (const input of [
      { components, recipient: 'other' },
      { components: [{ id: 'root', component: 'Button' }] },
      { components: [{ ...components[0], action: { event: { name: 'approve' } } }] },
      { components: [{ ...components[0], content: { call: 'openUrl' } }] },
      { components: [{ ...components[0], content: '<script>alert(1)</script>' }] },
      { components, dataModel: { payload: { functionCall: {} } } }
    ]) expect(() => tool.parse('present', input)).toThrow();
  });

  it('requires both schema validation and reference closure and deletes temporary JSON', async () => {
    const broker = new DwsBroker(config());
    let path = '';
    const run = vi.spyOn(broker, 'runCommand').mockImplementation(async (identity, args) => {
      expect(identity).toEqual(user);
      path = args[args.indexOf('--file') + 1]!;
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(messages);
      expect(args).toContain('new-card');
      return { valid: true, preflight: { valid: false }, a2uiMessages: ['{}'] };
    });
    await expect(broker.lintA2ui(user, messages)).rejects.toThrow('A2UI_PREFLIGHT_FAILED');
    await expect(readFile(path)).rejects.toThrow();
    run.mockResolvedValue({ valid: true, preflight: { valid: true }, a2uiMessages: messages.map(m => JSON.stringify(m)) });
    await expect(broker.lintA2ui(user, messages)).resolves.toHaveLength(2);
  });

  it('sends to the original group with the invoking identity and finalizes using its returned bizId', async () => {
    const broker = new DwsBroker(config());
    const run = vi.spyOn(broker, 'runCommand').mockResolvedValueOnce({ bizId: 'returned-card' }).mockResolvedValueOnce({ accepted: true });
    await expect(broker.sendA2ui(user, { type: 'group', id: 'original-group' }, messages.map(m => JSON.stringify(m))))
      .resolves.toEqual({ accepted: true, renderingVerified: false, bizId: 'returned-card' });
    expect(run.mock.calls[0]?.[0]).toEqual(user);
    expect(run.mock.calls[0]?.[1]).toContain('original-group');
    expect(run.mock.calls[1]?.[1]).toContain('returned-card');
    expect(run.mock.calls[1]?.[1]).toContain('FINISH');
    const args = run.mock.calls[1]![1];
    expect(JSON.parse(args[args.indexOf('--content') + 1]!)).toHaveLength(1);
  });

  it('does not retry an ambiguous send or finalize and rejects a cross-user DM target', async () => {
    const broker = new DwsBroker(config());
    const run = vi.spyOn(broker, 'runCommand').mockResolvedValue({});
    await expect(broker.sendA2ui(user, { type: 'direct', id: 'other' }, messages.map(m => JSON.stringify(m))))
      .rejects.toThrow('A2UI_DIRECT_SURFACE_MISMATCH');
    expect(run).not.toHaveBeenCalled();
    await expect(broker.sendA2ui(user, { type: 'direct', id: user.userId }, messages.map(m => JSON.stringify(m))))
      .rejects.toThrow('A2UI_DELIVERY_OUTCOME_UNKNOWN');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toContain(user.userId);
  });

  it.each([false, true])('persists idempotency across repeated Agent calls (ambiguous=%s)', async (ambiguous) => {
    const repo = new InMemoryRepository();
    const responses: any[] = [];
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'corp:member' })),
      lintA2ui: vi.fn(async () => messages.map(m => JSON.stringify(m))),
      sendA2ui: vi.fn(async () => {
        if (ambiguous) throw new Error('A2UI_DELIVERY_OUTCOME_UNKNOWN');
        return { accepted: true, bizId: 'card', renderingVerified: false };
      })
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'a2ui-thread'),
      turn: vi.fn(async (_thread: string, _input: string, _event: unknown, onRequest: (r: CodexApprovalRequest) => Promise<any>) => {
        for (let i = 0; i < 2; i++) responses.push(await onRequest({ method: 'item/tool/call', params: { namespace: 'a2ui', tool: 'present', arguments: {
          components: i === 0 ? components : [{ content: '查询结果', component: 'Markdown', id: 'root' }]
        } } }));
        return { text: '完成展示', threadId: 'a2ui-thread' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClientLike;
    const request: AgentRequest = { requestId: 'a2ui-request', messageId: 'a2ui-message', user,
      surface: { type: 'group', id: 'original-group' }, text: '按卡片分组展示', attachments: [], receivedAt: Date.now() };
    const orchestrator = new TaskOrchestrator(config(), repo, codex, broker, { async send() {} });
    const task = await orchestrator.accept(request);
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(broker.sendA2ui).toHaveBeenCalledTimes(1);
    expect(broker.sendA2ui).toHaveBeenCalledWith(user, request.surface, expect.any(Array));
    expect(responses[0].success).toBe(!ambiguous);
    expect(responses[1].success).toBe(!ambiguous);
    if (ambiguous) expect(responses[1].contentItems[0].text).toContain('WRITE_OUTCOME_UNKNOWN');
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
  });
});
