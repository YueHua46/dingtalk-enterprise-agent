import { describe, expect, it } from 'vitest';
import { accepted, completed, confirmation, failed } from '../src/markdown.js';
import type { TaskRecord } from '../src/types.js';

const task: TaskRecord = {
  id: 'T-1',
  status: 'queued',
  createdAt: Date.now(),
  request: {
    requestId: 'R-1',
    messageId: 'M-1',
    user: { corpId: 'corp', userId: 'user', displayName: '测试用户' },
    surface: { type: 'direct', id: 'user' },
    text: '查文档',
    attachments: [],
    receivedAt: Date.now()
  }
};

describe('markdown renderer', () => {
  it('renders task acknowledgement with routing context', () => {
    const output = accepted(task);
    expect(output).toContain('T-1');
    expect(output).toContain('私聊');
    expect(output).toContain('取消 T-1');
  });

  it('renders exact confirmation and cancellation commands', () => {
    const output = confirmation({
      taskId: 'T-2',
      user: { corpId: 'corp', userId: 'user' },
      action: { name: '创建待办', risk: 'write', target: '示例', parameters: { title: '示例待办' } },
      parameterHash: 'hash',
      expiresAt: Date.now() + 60_000
    });
    expect(output).toContain('确认 T-2');
    expect(output).toContain('取消 T-2');
    expect(output).toContain('参数：');
    expect(output).toContain('示例待办');
    expect(output).toContain('影响：');
  });

  it('renders terminal states', () => {
    expect(completed('T-1', '结果')).toBe('结果');
    expect(failed('T-1', '失败')).toContain('执行失败');
  });
});
