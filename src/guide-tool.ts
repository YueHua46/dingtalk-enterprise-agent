import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Config } from './config.js';

type GuideName = string;

export const guideDynamicTools = [{
  type: 'namespace',
  name: 'reference',
  description: '读取本 Agent 已安装的公开操作说明，不访问钉钉资源、用户数据或凭证。',
  tools: [{
    type: 'function', name: 'list_guides', description: '列出已安装 Skill 的名称与用途，可按需读取其说明。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  }, {
    type: 'function',
    name: 'read_guide',
    description: '无需用户确认，读取已安装 Skill 或其 references/sub-skills。先用 list_guides 查看名称；不要使用 shell 读取 Skill 文件。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
        subSkill: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
        reference: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' }
      },
      required: ['name']
    }
  }]
}];

export class GuideTool {
  public constructor(
    private readonly config: Pick<Config, 'SKILLS_DIR'>,
    private readonly codexHome = process.env.CODEX_HOME ?? resolve(homedir(), '.codex')
  ) {}

  public async execute(input: unknown): Promise<{ name: GuideName; subSkill?: string; reference?: string; text: string }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('GUIDE_ARGUMENTS_INVALID');
    const name = (input as Record<string, unknown>).name;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) throw new Error('GUIDE_NOT_REGISTERED');
    const subSkill = (input as Record<string, unknown>).subSkill;
    if (subSkill !== undefined && (typeof subSkill !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(subSkill))) {
      throw new Error('GUIDE_SUBSKILL_INVALID');
    }
    const reference = (input as Record<string, unknown>).reference;
    if (reference !== undefined && (typeof reference !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(reference))) {
      throw new Error('GUIDE_REFERENCE_INVALID');
    }
    const root = name === 'openai-docs'
      ? resolve(this.codexHome, 'skills', '.system', 'openai-docs')
      : resolve(this.config.SKILLS_DIR, name);
    const target = typeof subSkill === 'string'
      ? join(root, 'sub-skills', subSkill, 'SKILL.md')
      : typeof reference === 'string'
        ? join(root, 'references', reference + '.md')
        : join(root, 'SKILL.md');
    let realRoot: string;
    let realFile: string;
    try { [realRoot, realFile] = await Promise.all([realpath(root), realpath(target)]); }
    catch {
      if (reference) throw new Error('GUIDE_REFERENCE_INVALID');
      if (subSkill) throw new Error('GUIDE_SUBSKILL_INVALID');
      throw new Error('GUIDE_NOT_REGISTERED');
    }
    const subpath = relative(realRoot, realFile);
    if (!subpath || subpath === '..' || subpath.startsWith('..' + sep) || isAbsolute(subpath)) {
      throw new Error('GUIDE_PATH_NOT_ALLOWED');
    }
    const info = await stat(realFile);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error('GUIDE_SIZE_NOT_ALLOWED');
    return {
      name,
      ...(typeof subSkill === 'string' ? { subSkill } : {}),
      ...(typeof reference === 'string' ? { reference } : {}),
      text: await readFile(realFile, 'utf8')
    };
  }

  public async list(): Promise<Array<{ name: string; description: string; subSkills?: string[] }>> {
    const entries = await readdir(this.config.SKILLS_DIR, { withFileTypes: true });
    const output: Array<{ name: string; description: string; subSkills?: string[] }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name)) continue;
      try {
        const content = await readFile(join(this.config.SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8');
        const description = /^description:\s*(.+)$/m.exec(content.slice(0, 4000))?.[1]?.trim() ?? '';
        let subSkills: string[] | undefined;
        try { subSkills = (await readdir(join(this.config.SKILLS_DIR, entry.name, 'sub-skills'), { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name); } catch { /* optional */ }
        output.push({ name: entry.name, description: description.slice(0, 300), ...(subSkills?.length ? { subSkills } : {}) });
      } catch { /* skip unreadable skill */ }
    }
    return output;
  }
}
