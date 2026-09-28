import { describe, expect, it } from 'vitest';
import { accepted, approvalCardContent, completed, failed } from '../src/markdown.js';
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

  it('renders approval details inside the card without text commands', () => {
    const output = approvalCardContent({
      taskId: 'T-2',
      user: { corpId: 'corp', userId: 'user' },
      action: { name: '创建待办', risk: 'write', target: '示例', parameters: { title: '示例待办' } },
      parameterHash: 'hash',
      expiresAt: Date.now() + 60_000
    });
    expect(output).toContain('仅任务发起人点击有效');
    expect(output).not.toContain('确认 T-2');
    expect(output).not.toContain('取消 T-2');
    expect(output).toContain('title：示例待办');
    expect(output).toContain('影响：');
    expect(output).not.toContain('"title"');
  });

  it('renders the business summary when the action carries one', () => {
    const output = approvalCardContent({
      taskId: 'T-4',
      user: { corpId: 'corp', userId: 'user' },
      action: {
        name: '钉钉 doc.update',
        risk: 'write',
        parameters: { capability: 'doc.update', args: ['--node', 'n1'] },
        summary: {
          description: '把"Hello World"追加到文档《测试文档》的末尾',
          impact: '仅该文档的正文内容会变化',
          details: ['目标文档：测试文档（n1）', '内容摘要：Hello World']
        }
      },
      parameterHash: 'hash',
      expiresAt: Date.now() + 60_000
    });
    expect(output).toContain('把"Hello World"追加到文档《测试文档》的末尾');
    expect(output).toContain('仅该文档的正文内容会变化');
    expect(output).toContain('内容摘要：Hello World');
    expect(output).not.toContain('--node');
  });

  it('shows remaining confirmation time on the card', () => {
    const output = approvalCardContent({
      taskId: 'T-3',
      user: { corpId: 'corp', userId: 'user' },
      action: { name: '创建待办', risk: 'write' },
      parameterHash: 'hash',
      expiresAt: Date.parse('2026-09-23T10:37:25Z')
    });
    expect(output).toContain('分钟内确认');
  });

  it('renders terminal states', () => {
    expect(completed('T-1', '结果')).toBe('结果');
    expect(failed('T-1', '失败')).toContain('执行失败');
  });
});
