import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Config } from './config.js';

type GuideName = 'dingtalk-office' | 'openai-docs';

export const guideDynamicTools = [{
  type: 'namespace',
  name: 'reference',
  description: '读取本 Agent 已安装的公开操作说明，不访问钉钉资源、用户数据或凭证。',
  tools: [{
    type: 'function',
    name: 'read_guide',
    description: '无需用户确认，读取已安装的钉钉办公或 OpenAI Docs Skill 说明。不要使用 shell 读取 Skill 文件。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string', enum: ['dingtalk-office', 'openai-docs'] } },
      required: ['name']
    }
  }]
}];

export class GuideTool {
  public constructor(
    private readonly config: Pick<Config, 'SKILLS_DIR'>,
    private readonly codexHome = process.env.CODEX_HOME ?? resolve(homedir(), '.codex')
  ) {}

  public async execute(input: unknown): Promise<{ name: GuideName; text: string }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('GUIDE_ARGUMENTS_INVALID');
    const name = (input as Record<string, unknown>).name;
    if (name !== 'dingtalk-office' && name !== 'openai-docs') throw new Error('GUIDE_NOT_REGISTERED');
    const root = name === 'dingtalk-office'
      ? resolve(this.config.SKILLS_DIR, 'dingtalk-office')
      : resolve(this.codexHome, 'skills', '.system', 'openai-docs');
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(join(root, 'SKILL.md'))]);
    const subpath = relative(realRoot, realFile);
    if (!subpath || subpath === '..' || subpath.startsWith('..' + sep) || isAbsolute(subpath)) {
      throw new Error('GUIDE_PATH_NOT_ALLOWED');
    }
    const info = await stat(realFile);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error('GUIDE_SIZE_NOT_ALLOWED');
    return { name, text: await readFile(realFile, 'utf8') };
  }
}
