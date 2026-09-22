import type { RiskLevel, ToolAction, UserIdentity } from './types.js';
import { DwsBroker } from './dws-broker.js';
import { generatedDwsCapabilities } from './generated-dws-capabilities.js';

const capabilityNames = Object.keys(generatedDwsCapabilities);
const forbiddenFlags = new Set([
  '--profile', '--format', '--yes', '-y', '--token', '--client-id',
  '--client-secret', '--pre-url', '--mcp-url', '--mock'
]);

export interface DwsToolInput {
  capability: string;
  args?: string[];
}

export const dwsDynamicTools = [{
  type: 'namespace',
  name: 'dingtalk',
  description: '以当前钉钉聊天用户身份执行钉钉办公操作。宿主强制权限隔离、审计和写操作确认。',
  tools: [{
    type: 'function',
    name: 'dws',
    description: '调用已注册的 DWS 办公能力。capability 必须来自宿主按当前 DWS 版本生成的能力表，args 仅包含该能力的业务参数令牌。禁止传 profile、format、yes、token 或应用密钥。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        capability: {
          type: 'string',
          enum: capabilityNames
        },
        args: {
          type: 'array',
          maxItems: 40,
          items: { type: 'string', maxLength: 4000 }
        }
      },
      required: ['capability']
    }
  }]
}];

export class DwsTool {
  public constructor(private readonly broker: DwsBroker) {}

  public parse(input: unknown): DwsToolInput {
    if (!input || typeof input !== 'object') throw new Error('DWS tool arguments must be an object');
    const value = input as Record<string, unknown>;
    if (typeof value.capability !== 'string' || !(value.capability in generatedDwsCapabilities)) throw new Error('DWS capability is not registered');
    const args = value.args ?? [];
    if (!Array.isArray(args) || args.length > 40 || args.some((item) => typeof item !== 'string')) {
      throw new Error('DWS arguments are invalid');
    }
    for (const token of args as string[]) {
      const normalized = token.toLowerCase();
      if (forbiddenFlags.has(normalized) || normalized.includes('secret') || normalized.includes('token=')) {
        throw new Error('DWS argument is forbidden: ' + token);
      }
      if (token.includes('\0') || token.includes('\r') || token.includes('\n')) {
        throw new Error('DWS argument contains control characters');
      }
    }
    return { capability: value.capability, args: args as string[] };
  }

  public classify(input: DwsToolInput): RiskLevel {
    return this.capability(input).risk;
  }

  public action(input: DwsToolInput): ToolAction {
    const capability = this.capability(input);
    return {
      name: '钉钉 ' + input.capability,
      risk: this.classify(input),
      target: input.args?.join(' ').slice(0, 500) || capability.service,
      parameters: input
    };
  }

  public async execute(user: UserIdentity, input: DwsToolInput, confirmed: boolean): Promise<unknown> {
    const risk = this.classify(input);
    if (risk !== 'read' && !confirmed) throw new Error('DWS_CONFIRMATION_REQUIRED');
    const capability = this.capability(input);
    const args = [capability.service, ...capability.command, ...(input.args ?? [])];
    if (risk !== 'read') args.push('--yes');
    return this.broker.runCommand(user, args);
  }

  private capability(input: DwsToolInput): { service: string; command: readonly string[]; risk: RiskLevel; description: string } {
    const capability = generatedDwsCapabilities[input.capability as keyof typeof generatedDwsCapabilities];
    if (!capability) throw new Error('DWS capability is not registered');
    return capability;
  }
}
