import { describe, expect, it } from 'vitest';
import { classifyAction, isCancellation, isConfirmation, requiresConfirmation } from '../src/policy.js';

describe('policy', () => {
  it('classifies read operations without write words as read', () => {
    expect(classifyAction({ name: '搜索文档', risk: 'read' })).toBe('read');
    expect(requiresConfirmation('read')).toBe(false);
  });

  it('requires one confirmation for writes and high-risk operations', () => {
    expect(classifyAction({ name: '创建日程', risk: 'read' })).toBe('read');
    expect(classifyAction({ name: '创建日程', risk: 'write' })).toBe('write');
    expect(classifyAction({ name: '修改权限', risk: 'high' })).toBe('high');
    expect(requiresConfirmation('write')).toBe(true);
    expect(requiresConfirmation('high')).toBe(true);
  });

  it('parses task control messages exactly', () => {
    expect(isConfirmation('确认 T-1', 'T-1')).toBe(true);
    expect(isConfirmation('确认 T-2', 'T-1')).toBe(false);
    expect(isCancellation('取消 T-1', 'T-1')).toBe(true);
    expect(isCancellation('取消当前任务')).toBe(true);
  });
});
