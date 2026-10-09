export interface ToolIdentity {
  namespace: string;
  name: string;
}

export interface AdaptedModelRequest {
  body: Record<string, unknown>;
  toolNames: Map<string, ToolIdentity>;
}

/** Responses tool names accepted by the compatibility bridge are limited to
 * letters, digits, `_` and `-`. Codex namespaces may contain dotted operation
 * names (for example `agent.ui.render`), so flattening must sanitize the child
 * name while retaining the original identity in `toolNames`. */
function providerToolName(namespace: string, name: string): string {
  return `${namespace}__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** Reconcile Codex's Responses namespace extension with Sub2API's Antigravity bridge. */
export function adaptModelRequest(value: unknown): AdaptedModelRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model request');
  const body = structuredClone(value) as Record<string, unknown>;
  const toolNames = new Map<string, ToolIdentity>();
  const flatten = (tools: unknown): unknown => {
    if (!Array.isArray(tools)) return tools;
    const output: unknown[] = [];
    for (const raw of tools) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { output.push(raw); continue; }
      const tool = raw as Record<string, unknown>;
      if (tool.type !== 'namespace' || typeof tool.name !== 'string') { output.push(tool); continue; }
      const children = Array.isArray(tool.tools) ? tool.tools : Array.isArray(tool.children) ? tool.children : [];
      for (const rawChild of children) {
        if (!rawChild || typeof rawChild !== 'object' || Array.isArray(rawChild)) continue;
        const child = rawChild as Record<string, unknown>;
        if (child.type !== 'function' || typeof child.name !== 'string') continue;
        const flatName = providerToolName(tool.name, child.name);
        if (toolNames.has(flatName)) throw new Error('Duplicate model tool name');
        toolNames.set(flatName, { namespace: tool.name, name: child.name });
        // The provider sees flat functions, so their descriptions must carry
        // both the namespace's rules and the individual operation's purpose.
        // Dropping the parent description silently discards source boundaries,
        // citation requirements, and other shared tool contracts.
        const description = [tool.description, child.description]
          .filter((text): text is string => typeof text === 'string' && text.length > 0)
          .join('\n\n');
        output.push({ ...child, name: flatName, ...(description ? { description } : {}) });
      }
    }
    return output;
  };
  body.tools = flatten(body.tools);
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entry = item as Record<string, unknown>;
        if (entry.type === 'additional_tools') entry.tools = flatten(entry.tools);
      }
    }
  }
  const rewriteHistory = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(rewriteHistory); return; }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (item.type === 'function_call' && typeof item.namespace === 'string' && typeof item.name === 'string') {
      const flatName = providerToolName(item.namespace, item.name);
      if (toolNames.has(flatName)) {
        item.name = flatName;
        delete item.namespace;
      }
    }
    Object.values(item).forEach(rewriteHistory);
  };
  rewriteHistory(body.input);
  const choice = body.tool_choice;
  if (choice && typeof choice === 'object' && !Array.isArray(choice)) {
    const item = choice as Record<string, unknown>;
    if (item.type === 'namespace') body.tool_choice = 'auto';
    else if (typeof item.namespace === 'string' && typeof item.name === 'string') {
      const flatName = `${item.namespace}__${item.name}`;
      if (toolNames.has(flatName)) { item.name = flatName; delete item.namespace; }
    }
  }
  return { body, toolNames };
}

export function restoreModelResponse(value: unknown, toolNames: Map<string, ToolIdentity>): unknown {
  if (Array.isArray(value)) return value.map((item) => restoreModelResponse(item, toolNames));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) output[key] = restoreModelResponse(item, toolNames);
  if (output.type === 'function_call' && typeof output.name === 'string') {
    const identity = toolNames.get(output.name);
    if (identity) { output.name = identity.name; output.namespace = identity.namespace; }
  }
  return output;
}

export function restoreSseChunk(chunk: string, toolNames: Map<string, ToolIdentity>): string {
  return chunk.split(/\r?\n/).map((line) => {
    if (!line.startsWith('data: ')) return line;
    const data = line.slice(6);
    if (data === '[DONE]') return line;
    try { return 'data: ' + JSON.stringify(restoreModelResponse(JSON.parse(data), toolNames)); }
    catch { return line; }
  }).join('\n');
}
