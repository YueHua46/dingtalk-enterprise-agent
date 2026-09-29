import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Config } from './config.js';

type GuideName = string;

export interface SkillSummary {
  name: string;
  description: string;
  subSkills?: string[];
  references?: string[];
  documents?: string[];
  scripts?: string[];
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const DOCUMENT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);
const MAX_GUIDE_BYTES = 64 * 1024;
const INDEX_TTL_MS = 5 * 60 * 1000;

export const guideDynamicTools = [{
  type: 'namespace',
  name: 'reference',
  description: '读取本 Agent 已安装的 Skill 说明，不访问钉钉资源、用户数据或凭证。',
  tools: [{
    type: 'function', name: 'list_guides', description: '列出已安装 Skill 的名称、用途、子 Skill、参考文档与脚本。任务提示已附带索引时通常无需再调用。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  }, {
    type: 'function',
    name: 'read_guide',
    description: '读取已安装 Skill 的文档。只传 name 读取 SKILL.md；subSkill 读取子 Skill；reference 读取 references/ 下同名文档（不带 .md，可为中文名）；path 读取 Skill 目录内任意文本文档的相对路径（如 agents/report-writer.md）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
        subSkill: { type: 'string', maxLength: 120 },
        reference: { type: 'string', maxLength: 120 },
        path: { type: 'string', maxLength: 240 }
      },
      required: ['name']
    }
  }]
}];

export class GuideTool {
  private indexCache: { expiresAt: number; text: string } | undefined;

  public constructor(
    private readonly config: Pick<Config, 'SKILLS_DIR'>,
    private readonly codexHome = process.env.CODEX_HOME ?? resolve(homedir(), '.codex')
  ) {}

  public async execute(input: unknown): Promise<{ name: GuideName; subSkill?: string; reference?: string; path?: string; text: string }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('GUIDE_ARGUMENTS_INVALID');
    const args = input as Record<string, unknown>;
    const name = args.name;
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new Error('GUIDE_NOT_REGISTERED');
    const { subSkill, reference, path } = args;
    if (subSkill !== undefined && !safeSegment(subSkill)) throw new Error('GUIDE_SUBSKILL_INVALID');
    if (reference !== undefined && !safeSegment(reference)) throw new Error('GUIDE_REFERENCE_INVALID');
    if (path !== undefined && !safeRelativePath(path)) throw new Error('GUIDE_PATH_INVALID');
    const root = name === 'openai-docs'
      ? resolve(this.codexHome, 'skills', '.system', 'openai-docs')
      : resolve(this.config.SKILLS_DIR, name);
    const base = typeof subSkill === 'string' ? join(root, 'sub-skills', subSkill) : root;
    const target = typeof path === 'string'
      ? join(base, ...path.split('/'))
      : typeof reference === 'string'
        ? join(base, 'references', reference + '.md')
        : join(base, 'SKILL.md');
    let realRoot: string;
    let realFile: string;
    try { [realRoot, realFile] = await Promise.all([realpath(root), realpath(target)]); }
    catch {
      if (path !== undefined) throw new Error(`GUIDE_PATH_INVALID: ${await this.availableDocuments(root)}`);
      if (reference !== undefined) throw new Error(`GUIDE_REFERENCE_INVALID: ${await this.availableDocuments(root)}`);
      if (subSkill !== undefined) throw new Error('GUIDE_SUBSKILL_INVALID');
      throw new Error('GUIDE_NOT_REGISTERED');
    }
    const subpath = relative(realRoot, realFile);
    if (!subpath || subpath === '..' || subpath.startsWith('..' + sep) || isAbsolute(subpath)) {
      throw new Error('GUIDE_PATH_NOT_ALLOWED');
    }
    const info = await stat(realFile);
    if (!info.isFile() || info.size > MAX_GUIDE_BYTES) throw new Error('GUIDE_SIZE_NOT_ALLOWED');
    return {
      name,
      ...(typeof subSkill === 'string' ? { subSkill } : {}),
      ...(typeof reference === 'string' ? { reference } : {}),
      ...(typeof path === 'string' ? { path } : {}),
      text: await readFile(realFile, 'utf8')
    };
  }

  public async list(): Promise<SkillSummary[]> {
    const entries = await readdir(this.config.SKILLS_DIR, { withFileTypes: true });
    const output: SkillSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !NAME_PATTERN.test(entry.name)) continue;
      const root = join(this.config.SKILLS_DIR, entry.name);
      try {
        const content = await readFile(join(root, 'SKILL.md'), 'utf8');
        const description = frontmatterDescription(content);
        const subSkills = await directoryNames(join(root, 'sub-skills'));
        const references = (await fileNames(join(root, 'references'))).filter((file) => extname(file) === '.md').map((file) => file.slice(0, -3));
        const documents = (await listFiles(root, 3)).filter((file) => DOCUMENT_EXTENSIONS.has(extname(file)) && file !== 'SKILL.md'
          && !file.startsWith('references/') && !file.startsWith('sub-skills/') && !/^(tests|examples|evals)\//.test(file)).slice(0, 12);
        const scripts = (await fileNames(join(root, 'scripts'))).filter((file) => /\.(py|sh|mjs|js)$/.test(file) && !file.startsWith('__'));
        output.push({ name: entry.name, description: description.slice(0, 400),
          ...(subSkills.length ? { subSkills } : {}), ...(references.length ? { references } : {}),
          ...(documents.length ? { documents } : {}), ...(scripts.length ? { scripts } : {}) });
      } catch { /* skip unreadable skill */ }
    }
    return output;
  }

  /** Compact skill index for the task prompt (progressive disclosure: names and purposes only). */
  public async index(): Promise<string> {
    if (this.indexCache && this.indexCache.expiresAt > Date.now()) return this.indexCache.text;
    const skills = await this.list().catch(() => []);
    const text = skills.map((skill) => [
      `- ${skill.name}：${skill.description}`,
      skill.subSkills?.length ? `  子 Skill：${skill.subSkills.join(', ')}` : '',
      skill.references?.length ? `  参考：${skill.references.join(', ')}` : '',
      skill.documents?.length ? `  其他文档：${skill.documents.join(', ')}` : '',
      skill.scripts?.length ? `  脚本：${skill.scripts.join(', ')}` : ''
    ].filter(Boolean).join('\n')).join('\n');
    this.indexCache = { expiresAt: Date.now() + INDEX_TTL_MS, text };
    return text;
  }

  private async availableDocuments(root: string): Promise<string> {
    const files = (await listFiles(root, 3).catch(() => [])).filter((file) => DOCUMENT_EXTENSIONS.has(extname(file))).slice(0, 30);
    return files.length ? '可用文档：' + files.join(', ') : '该 Skill 没有其他文档';
  }
}

function safeSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 120 && value !== '.' && value !== '..'
    && !/[\\/\0:]/.test(value) && !value.startsWith('.');
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 240 || value.startsWith('/')) return false;
  const segments = value.split('/');
  return segments.every(safeSegment) && DOCUMENT_EXTENSIONS.has(extname(value).toLowerCase());
}

function frontmatterDescription(content: string): string {
  const head = content.slice(0, 4000);
  const match = /^description:\s*(.*)$/m.exec(head);
  if (!match) return '';
  const inline = match[1]!.trim();
  if (inline && !['|', '>', '|-', '>-'].includes(inline)) return inline.replace(/^["']|["']$/g, '');
  // Folded or literal YAML block: take the indented continuation lines.
  const rest = head.slice(match.index + match[0].length).split('\n').slice(1);
  const lines: string[] = [];
  for (const line of rest) {
    if (!/^\s+\S/.test(line)) break;
    lines.push(line.trim());
  }
  return lines.join(' ');
}

async function directoryNames(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter((item) => item.isDirectory() && !item.name.startsWith('.')).map((item) => item.name).sort(); }
  catch { return []; }
}

async function fileNames(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter((item) => item.isFile()).map((item) => item.name).sort(); }
  catch { return []; }
}

async function listFiles(root: string, depth: number, prefix = ''): Promise<string[]> {
  if (depth < 0) return [];
  let entries;
  try { entries = await readdir(join(root, prefix), { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__' || entry.name === 'node_modules') continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, depth - 1, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
