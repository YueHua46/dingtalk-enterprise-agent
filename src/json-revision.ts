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

function pointerSegments(path: string, root: string): string[] {
  const parts = path.split('/').slice(1).map(part => {
    if (/~(?![01])/.test(part)) throw new Error('JSON_REVISION_PATH_INVALID');
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!decoded || unsafeKeys.has(decoded)) throw new Error('JSON_REVISION_PATH_INVALID');
    return decoded;
  });
  if (parts[0] !== root || parts.length < 2) throw new Error('JSON_REVISION_PATH_INVALID');
  return parts;
}

function existingChild(parent: unknown, key: string): unknown {
  if (!parent || typeof parent !== 'object') throw new Error('JSON_REVISION_PATH_NOT_FOUND');
  if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= parent.length)) throw new Error('JSON_REVISION_PATH_NOT_FOUND');
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('JSON_REVISION_PATH_NOT_FOUND');
  return (parent as Record<string, unknown>)[key];
}

export function applyContentChanges<T>(draft: T, changes: Array<{path: string; op?: 'set' | 'remove' | undefined; value?: unknown}>, root: string): T {
  const next = structuredClone(draft);
  for (const change of changes) {
    const parts = pointerSegments(change.path, root);
    let parent: unknown = next;
    for (const key of parts.slice(0, -1)) parent = existingChild(parent, key);
    const key = parts[parts.length - 1]!;
    if (!parent || typeof parent !== 'object') throw new Error('JSON_REVISION_PATH_NOT_FOUND');
    if (change.op === 'remove') {
      existingChild(parent, key);
      if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete (parent as Record<string, unknown>)[key];
    } else if (Array.isArray(parent)) {
      if (key === '-') parent.push(structuredClone(change.value));
      else { if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > parent.length) throw new Error('JSON_REVISION_PATH_NOT_FOUND'); parent[Number(key)] = structuredClone(change.value); }
    } else (parent as Record<string, unknown>)[key] = structuredClone(change.value);
  }
  return next;
}
