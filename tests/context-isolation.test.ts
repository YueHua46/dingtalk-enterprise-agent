import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import type { AgentRequest } from '../src/types.js';

const config = loadConfig({ NODE_ENV: 'test', TASK_WORKFLOW_MODE: 'off', DINGTALK_ROBOT_CODE: 'robot',
  DINGTALK_CLIENT_ID: 'id', DINGTALK_CLIENT_SECRET: 'secret', DWS_BOT_PROFILE: 'bot', INTERNAL_API_TOKEN: 'x'.repeat(32) });

function request(id: string, surface: 'group' | 'direct' = 'group'): AgentRequest {
  return { requestId: id, messageId: id, user: { corpId: 'corp', userId: 'user' },
    surface: { type: surface, id: surface === 'group' ? 'group-1' : 'user' },
    text: `请求 ${id}`, attachments: [], receivedAt: Date.now() };
}

describe('task execution context isolation', () => {
  it('starts a fresh model thread for each new task in the same group', async () => {
    const repo = new InMemoryRepository();
    let serial = 0;
    const codex = { startThread: vi.fn(async () => `thread-${++serial}`),
      turn: vi.fn(async (threadId: string) => ({ text: `来自 ${threadId}`, threadId })),
      interrupt: vi.fn(async () => undefined) };
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, { async send() {} });
    const first = await orchestrator.accept(request('first'));
    await vi.waitFor(async () => expect((await repo.findTask(first!.id))?.status).toBe('completed'));
    const second = await orchestrator.accept(request('second'));
    await vi.waitFor(async () => expect((await repo.findTask(second!.id))?.status).toBe('completed'));
    expect(codex.startThread).toHaveBeenCalledTimes(2);
    expect(codex.turn.mock.calls.map((call) => call[0])).toEqual(['thread-1', 'thread-2']);
    await orchestrator.stop();
  });

  it('only exposes recent answers to the same direct chat and clears them on new conversation', async () => {
    const repo = new InMemoryRepository();
    const direct = request('direct', 'direct');
    const surfaceId = await repo.ensureSurface(direct.user, direct.surface);
    const previous = await repo.createTask(direct, surfaceId);
    await repo.updateTask(previous.id, 'completed', { resultSummary: '个人待办内容' });
    const current = await repo.createTask(request('followup', 'direct'), surfaceId);
    expect(await repo.listRecentDirectContext(direct.user, surfaceId, current.id)).toEqual([
      { request: '请求 direct', answer: '个人待办内容' }
    ]);
    await repo.resetSurfaceThread(surfaceId);
    expect(await repo.listRecentDirectContext(direct.user, surfaceId, current.id)).toEqual([]);
    const groupSurfaceId = await repo.ensureSurface(direct.user, request('group').surface);
    const groupTask = await repo.createTask(request('group'), groupSurfaceId);
    await repo.updateTask(groupTask.id, 'completed', { resultSummary: '群任务个人资源', resultVisibility: 'private' });
    expect(await repo.listRecentDirectContext(direct.user, groupSurfaceId, current.id)).toEqual([]);
    const groupFollowup = await repo.createTask(request('group-followup'), groupSurfaceId);
    expect(await repo.listRecentPublicGroupContext(direct.user, groupSurfaceId, groupFollowup.id)).toEqual([]);
    const publicTask = await repo.createTask(request('public'), groupSurfaceId);
    await repo.updateTask(publicTask.id, 'completed', { resultSummary: '群内公开结论', resultVisibility: 'surface' });
    expect(await repo.listRecentPublicGroupContext(direct.user, groupSurfaceId, groupFollowup.id)).toEqual([
      { request: '请求 public', answer: '群内公开结论' }
    ]);
  });
});
