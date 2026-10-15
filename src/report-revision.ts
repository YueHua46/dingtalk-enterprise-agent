import { z } from 'zod';
import { factBindingSchema } from './evidence-facts.js';
import { reportRenderSchema, type ReportRender } from './report-render.js';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function isJsonValue(value: unknown, ancestors = new Set<unknown>(), depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from(value).every(item => isJsonValue(item, ancestors, depth + 1))
    : Object.entries(value).every(([key, item]) => !unsafeKeys.has(key) && isJsonValue(item, ancestors, depth + 1));
  ancestors.delete(value);
  return valid;
}

export const reportRevisionSchema = z.strictObject({
  draft_id: z.string().min(1).max(200),
  changes: z.array(z.union([z.strictObject({
    path: z.string().min(9).max(1000).startsWith('/report/'),
    op: z.literal('set').optional(),
    value: z.unknown().refine(value => isJsonValue(value), 'Replacement must be a JSON value')
  }), z.strictObject({path: z.string().min(9).max(1000).startsWith('/report/'), op: z.literal('remove')})])).min(1).max(40),
  fact_bindings: z.array(factBindingSchema).max(150).optional()
});
export type ReportRevision = z.infer<typeof reportRevisionSchema>;

export const reportRevisionTool = {
  type: 'function', name: 'revise_report',
  description: '仅恢复已有 draft_id 的历史广告报告；新任务使用 render_document 自由编排，不能用本工具新建旧模板。按宿主返回的 draft_id 局部修正报告。changes 使用 JSON pointer，例如 /report/executive_summary 或 /report/sections/0/paragraphs/1；{path,value}新增或替换字段，数组可整体替换以增减项目，末尾用 /- 追加，{path,op:"remove"}删除字段或数组项目。只提交需要修正的局部内容，不替换/report全文、模板或证据附表来源；最终必须符合报告schema。新fact_bindings按id替换或补充，历史不再引用的绑定自动清理，新绑定必须实际引用。',
  inputSchema: z.toJSONSchema(reportRevisionSchema)
};

function pointerSegments(path: string, root = 'report'): string[] {
  const parts = path.split('/').slice(1).map(part => {
    if (/~(?![01])/.test(part)) throw new Error('REPORT_REVISION_PATH_INVALID');
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!decoded || unsafeKeys.has(decoded)) throw new Error('REPORT_REVISION_PATH_INVALID');
    return decoded;
  });
  if (parts[0] !== root || parts.length < 2) throw new Error('REPORT_REVISION_PATH_INVALID');
  return parts;
}

function existingChild(parent: unknown, key: string): unknown {
  if (!parent || typeof parent !== 'object') throw new Error('REPORT_REVISION_PATH_NOT_FOUND');
  if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= parent.length))
    throw new Error('REPORT_REVISION_PATH_NOT_FOUND');
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('REPORT_REVISION_PATH_NOT_FOUND');
  return (parent as Record<string, unknown>)[key];
}

/** Shared safe JSON pointer interpreter. The caller validates the final schema. */
export function applyContentChanges<T>(draft: T, changes: Array<{path: string; op?: 'set' | 'remove' | undefined; value?: unknown}>, root: string): T {
  const next = structuredClone(draft);
  for (const change of changes) {
    const parts = pointerSegments(change.path, root);
    let parent: unknown = next;
    for (const key of parts.slice(0, -1)) parent = existingChild(parent, key);
    const key = parts[parts.length - 1]!;
    if (!parent || typeof parent !== 'object') throw new Error('REPORT_REVISION_PATH_NOT_FOUND');
    if (change.op === 'remove') {
      existingChild(parent, key);
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete (parent as Record<string, unknown>)[key];
    } else if (Array.isArray(parent)) {
      if (key === '-') parent.push(structuredClone(change.value));
      else {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > parent.length) throw new Error('REPORT_REVISION_PATH_NOT_FOUND');
        parent[Number(key)] = structuredClone(change.value);
      }
    } else (parent as Record<string, unknown>)[key] = structuredClone(change.value);
  }
  return next;
}

/** Host validates draft identity; this function applies only report-local replacements. */
export function applyReportRevision(draft: ReportRender, input: unknown): ReportRender {
  const args = reportRevisionSchema.parse(input);
  const next = applyContentChanges(reportRenderSchema.parse(draft), args.changes, 'report');
  if (args.fact_bindings) {
    const bindings = [...(next.fact_bindings ?? [])];
    const seen = new Set<string>();
    for (const binding of args.fact_bindings) {
      if (seen.has(binding.id)) throw new Error('FACT_ID_DUPLICATE');
      seen.add(binding.id);
      const index = bindings.findIndex(previous => previous.id === binding.id);
      if (index < 0) bindings.push(binding); else bindings[index] = binding;
    }
    next.fact_bindings = bindings;
  }
  const parsed = reportRenderSchema.parse(next);
  const referenced = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g)) referenced.add(match[1]!);
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(parsed.report);
  // A revision may carry the previous full binding list while changing only
  // one paragraph. Unused historical bindings are harmless and are removed
  // below; rejecting them forces the model into a full-list rewrite and was a
  // major source of non-converging report repair loops.
  if (parsed.fact_bindings) parsed.fact_bindings = parsed.fact_bindings.filter(binding => referenced.has(binding.id));
  return parsed;
}
