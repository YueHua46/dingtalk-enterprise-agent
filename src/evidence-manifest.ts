export interface EvidenceFileEntry {
  file: string;
  evidenceId: string;
  capabilityId: string;
  /** Legacy readers may still parse this string. Never clipped mid-JSON. */
  arguments: string;
  query?: Record<string, unknown>;
  sha256?: string;
  kind?: 'observation' | 'calculation' | 'report';
  rootKeys?: string[];
  tables?: Array<{ path: string; rows: number; fields: Record<string, string[]> }>;
  context?: Record<string, unknown>;
}

export function describeEvidence(raw: string): Pick<EvidenceFileEntry, 'rootKeys' | 'tables' | 'context'> {
  let value: any;
  try { value = JSON.parse(raw); } catch { return {}; }
  const tables: NonNullable<EvidenceFileEntry['tables']> = [];
  const visit = (node: any, path: string, depth: number) => {
    if (Array.isArray(node)) {
      const fields: Record<string, string[]> = {};
      for (const row of node) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        for (const [key, v] of Object.entries(row)) {
          const types = fields[key] ??= [];
          const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
          if (!types.includes(type)) types.push(type);
        }
      }
      tables.push({path, rows: node.length, fields});
    } else if (node && typeof node === 'object' && depth < 2) {
      for (const [key, child] of Object.entries(node)) visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  visit(value, '', 0);
  const context: Record<string, unknown> = {};
  for (const key of ['dataset', 'evidence']) if (value?.[key] !== undefined) context[key] = value[key];
  for (const key of ['period', 'dimensions', 'coverage', 'semantics', 'metric_units', 'metric_semantics', 'dimension_field_coverage', 'field_semantics', 'annotation_provenance', 'name_resolution']) {
    if (value?.data?.[key] !== undefined) context[key] = value.data[key];
  }
  return {rootKeys: value && typeof value === 'object' ? Object.keys(value) : [], tables, context};
}
