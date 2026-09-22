import type { Repository } from './persistence.js';
import type { ToolAction, UserIdentity } from './types.js';

export interface MemoryToolInput {
  operation: 'list' | 'set' | 'delete';
  key?: string;
  value?: string;
}

export const memoryDynamicTools = [{
  type: 'namespace',
  name: 'agent',
  description: '管理当前钉钉用户自己的长期偏好记忆。不得保存其他用户数据、原始对话、凭证或秘密。',
  tools: [{
    type: 'function',
    name: 'memory',
    description: '列出、保存或删除当前用户的长期偏好。set/delete 是写操作，宿主会要求用户确认。只有用户明确要求记住或忘记时才使用。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { type: 'string', enum: ['list', 'set', 'delete'] },
        key: { type: 'string', minLength: 1, maxLength: 80 },
        value: { type: 'string', minLength: 1, maxLength: 2000 }
      },
      required: ['operation']
    }
  }]
}];

export class MemoryTool {
  public constructor(private readonly repo: Repository) {}

  public parse(input: unknown): MemoryToolInput {
    if (!input || typeof input !== 'object') throw new Error('Memory tool arguments must be an object');
    const value = input as Record<string, unknown>;
    if (!['list', 'set', 'delete'].includes(String(value.operation))) throw new Error('Memory operation is invalid');
    const operation = value.operation as MemoryToolInput['operation'];
    const key = typeof value.key === 'string' ? value.key.trim() : undefined;
    const memoryValue = typeof value.value === 'string' ? value.value.trim() : undefined;
    if ((operation === 'set' || operation === 'delete') && (!key || key.length > 80)) throw new Error('Memory key is required');
    if (operation === 'set' && (!memoryValue || memoryValue.length > 2000)) throw new Error('Memory value is required');
    if (key && containsSecret(key)) throw new Error('MEMORY_SENSITIVE_CONTENT_REJECTED');
    if (memoryValue && containsSecret(memoryValue)) throw new Error('MEMORY_SENSITIVE_CONTENT_REJECTED');
    return { operation, ...(key ? { key } : {}), ...(memoryValue ? { value: memoryValue } : {}) };
  }

  public action(input: MemoryToolInput): ToolAction {
    return {
      name: input.operation === 'set' ? '保存用户长期记忆' : input.operation === 'delete' ? '删除用户长期记忆' : '读取用户长期记忆',
      risk: input.operation === 'list' ? 'read' : 'write',
      target: input.key ?? '当前用户记忆',
      parameters: input
    };
  }

  public async execute(user: UserIdentity, input: MemoryToolInput): Promise<unknown> {
    if (input.operation === 'list') return this.repo.listUserMemories(user);
    if (input.operation === 'set') {
      await this.repo.upsertUserMemory(user, { key: input.key!, value: input.value!, sensitivity: 'normal' });
      return { saved: true, key: input.key };
    }
    return { deleted: await this.repo.deleteUserMemory(user, input.key!), key: input.key };
  }
}

function containsSecret(value: string): boolean {
  return /(access[\s_-]*token|refresh[\s_-]*token|api[\s_-]*key|app[\s_-]*secret|client[\s_-]*secret|password|passwd|authorization|bearer\s+[a-z0-9._-]+|验证码|密码|密钥|令牌|cookie)/i.test(value);
}
