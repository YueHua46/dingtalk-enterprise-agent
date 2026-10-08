import { z } from 'zod';
import type { AgentRequest } from './types.js';
import type { DwsBroker } from './dws-broker.js';

export const A2UI_CATALOG = 'https://dingtalk.com/card/a2ui/catalogs/public/catalog.json';
const displayComponents = new Set(['Column', 'Row', 'Text', 'Markdown', 'Card', 'CollapsiblePanel', 'Divider']);
const sectionSchema = z.object({ title: z.string().min(1).max(120), markdown: z.string().min(1).max(8000) }).strict();
const inputSchema = z.object({
  components: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  dataModel: z.record(z.string(), z.unknown()).default({})
}).strict();

export const a2uiDynamicTools = [{
  type: 'namespace', name: 'a2ui', description: '动态 JSON 卡片展示，宿主绑定当前用户与原会话，发送前离线校验；交互写入仍由宿主确认。',
  tools: [
    { type: 'function', name: 'explain', description: '查询 DWS 内置 A2UI 组件、函数或 Token 协议说明。生成不熟悉的布局前先查询。', inputSchema: {
      type: 'object', additionalProperties: false, properties: { name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,79}$' } }, required: ['name'] } },
    { type: 'function', name: 'present', description: '将自由构建的 A2UI 展示卡片发到原会话。组件为扁平数组，root 为根组件，children 引用 ID。支持 Column/Row/Text/Markdown/Card/CollapsiblePanel/Divider 与 dataModel 路径绑定。当前不支持业务按钮、表单、函数、外部 Catalog。失败时使用文字回复，投递状态未知时禁止重复发送。', inputSchema: {
      type: 'object', additionalProperties: false, properties: {
        components: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: true } },
        dataModel: { type: 'object', additionalProperties: true }
      }, required: ['components'] } },
    { type: 'function', name: 'show_sections', description: '复用固定 JSON 骨架，将步骤、查询分组或对比结果展示成可折叠卡片。简单问答直接使用文字。', inputSchema: {
      type: 'object', additionalProperties: false, properties: { title: { type: 'string', maxLength: 120 },
        sections: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false,
          properties: { title: { type: 'string', maxLength: 120 }, markdown: { type: 'string', maxLength: 8000 } }, required: ['title', 'markdown'] } }
      }, required: ['title', 'sections'] } }
  ]
}];

/** Only display components are exposed until authenticated action callbacks are integrated. */
export class A2uiTool {
  public constructor(private readonly broker: DwsBroker) {}

  public parse(tool: string, raw: unknown): z.infer<typeof inputSchema> {
    let input: z.infer<typeof inputSchema>;
    if (tool === 'show_sections') {
      const sections = z.object({ title: z.string().min(1).max(120), sections: z.array(sectionSchema).min(1).max(12) }).strict().parse(raw);
      input = { dataModel: {}, components: [
        { id: 'root', component: 'Column', children: ['heading', ...sections.sections.map((_, i) => 'panel' + i)] },
        { id: 'heading', component: 'Text', text: sections.title },
        ...sections.sections.flatMap((section, i) => [
          { id: 'panel' + i, component: 'CollapsiblePanel', title: section.title, children: ['body' + i], fallbackMarkdown: section.markdown },
          { id: 'body' + i, component: 'Markdown', content: section.markdown }
        ])
      ] };
    } else if (tool === 'present') input = inputSchema.parse(raw);
    else throw new Error('A2UI_TOOL_UNKNOWN');
    // Leave room for JSON string-array and Windows argument quoting overhead.
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 12_000) throw new Error('A2UI_PAYLOAD_TOO_LARGE');
    for (const component of input.components) {
      if (!displayComponents.has(String(component.component))) throw new Error('A2UI_COMPONENT_NOT_ENABLED');
    }
    // No action, function execution, custom catalogs or embedded markup scripts.
    inspectDisplay(input);
    return canonicalDisplay(input) as z.infer<typeof inputSchema>;
  }

  public messages(taskId: string, input: z.infer<typeof inputSchema>): Record<string, unknown>[] {
    return [
      { version: 'v1.0', createSurface: { surfaceId: taskId, catalogId: A2UI_CATALOG, dataModel: input.dataModel } },
      { version: 'v1.0', updateComponents: { surfaceId: taskId, components: input.components } }
    ];
  }

  public async explain(request: AgentRequest, raw: unknown): Promise<unknown> {
    const { name } = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/) }).strict().parse(raw);
    return this.broker.runCommand(request.user, ['aicard', 'explain', name]);
  }
}

function canonicalDisplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalDisplay);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalDisplay(child)]));
  return value;
}

function inspectDisplay(value: unknown, depth = 0): void {
  if (depth > 24) throw new Error('A2UI_NESTING_TOO_DEEP');
  if (typeof value === 'string' && /<\s*(?:script|iframe|a\b)|(?:javascript|data|file):/i.test(value)) throw new Error('A2UI_UNSAFE_CONTENT');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['action', 'event', 'functionCall', 'call', 'catalogId', '__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('A2UI_ACTION_NOT_ENABLED');
    inspectDisplay(child, depth + 1);
  }
}
