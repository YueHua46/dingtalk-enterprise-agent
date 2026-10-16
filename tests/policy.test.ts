import { describe, expect, it } from 'vitest';
import { classifyAction, isCancellation, isConfirmation, isReferencedTaskCancellation, requiresConfirmation } from '../src/policy.js';

describe('policy', () => {
  it('accepts exact quoted cancel phrases without treating ordinary requests as controls',()=>{
    for(const text of ['取消','取消任务','<@robot> 取消任务','停止任务！','取消这个任务'])expect(isReferencedTaskCancellation(text)).toBe(true);
    for(const text of ['如何取消任务','不要取消任务','取消任务后再生成报告','取消当前任务','取消订单'])expect(isReferencedTaskCancellation(text)).toBe(false);
  });
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
