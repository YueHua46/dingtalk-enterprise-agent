import { z } from 'zod';
import type { EvidenceFileEntry } from './evidence-manifest.js';

// Integer identifiers outside this range have already lost precision in JavaScript.
// Require the provider's string form instead of silently selecting a rounded ID.
const scalar = z.union([z.string(), z.number().finite().refine(v => !Number.isInteger(v) || Number.isSafeInteger(v),
  'Use a string for integer identifiers outside the safe integer range'), z.boolean(), z.null()]);
export const factBindingSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  evidenceId: z.string().min(1), rows_path: z.string().default('data.rows'),
  where: z.record(z.string(), scalar).default({}), field: z.string().min(1),
  decimals: z.number().int().min(0).max(8).optional(),
  // Gemini rejects empty string enum members. Keep the legacy empty string
  // accepted by the host, and expose absence/null without an empty enum.
  suffix: z.string().regex(/^%?$/).nullable().default('')
});
export type FactBinding = z.infer<typeof factBindingSchema>;
export interface ResolvedFact {
  id: string; evidenceId: string; sourceSha256: string; rowsPath: string;
  rowIndex: number; selector: Record<string, unknown>; field: string;
  value: string | number | boolean | null; display: string;
  query?: Record<string, unknown>; context?: Record<string, unknown>;
  rowDimensions: Record<string, unknown>;
  lineage: Record<string, unknown>;
}

/** The model selects a fact; it cannot supply its value or source digest. */
export function prepareFactBindings(bindings: FactBinding[], sources: EvidenceFileEntry[]) {
  const ids = new Set<string>();
  return bindings.map(binding => {
    if (ids.has(binding.id)) throw new Error('FACT_ID_DUPLICATE');
    ids.add(binding.id);
    const source = sources.find(item => item.evidenceId === binding.evidenceId);
    const table = source?.tables?.find(item => item.path === binding.rows_path);
    if (!source?.sha256 || !['observation', 'calculation'].includes(source.kind ?? '') || !table)
      throw new Error('FACT_SOURCE_UNAVAILABLE');
    for (const field of [binding.field, ...Object.keys(binding.where)]) {
      if (!Object.prototype.hasOwnProperty.call(table.fields, field)) throw new Error('FACT_FIELD_UNAVAILABLE: ' + field);
    }
    return {...binding, suffix: binding.suffix ?? '', source: {file: source.file, sha256: source.sha256,
      query: source.query, context: source.context}};
  });
}

/** Fixed interpreter, not generated arithmetic. Selection must identify exactly one row.
 * Aggregation belongs in analysis.table, whose operation and input hash are persisted. */
export function factResolutionConfig(bindings: ReturnType<typeof prepareFactBindings>) {
  // Query/context can be much larger than a selector. Encode each distinct
  // source once while keeping its complete provenance for every resolved fact.
  const sources: Array<(typeof bindings)[number]['source']> = [];
  const sourceIndexes = new Map<string, number>();
  const compactBindings = bindings.map(({source, ...binding}) => {
    const key = JSON.stringify(source);
    let index = sourceIndexes.get(key);
    if (index === undefined) {
      index = sources.length;
      sourceIndexes.set(key, index);
      sources.push(source);
    }
    return {...binding, source: index};
  });
  return JSON.stringify({sources, bindings: compactBindings});
}

export function factResolutionCode(bindings: ReturnType<typeof prepareFactBindings>, configFile?: {file: string; sha256: string}, compactOutput = false) {
  const encoded = Buffer.from(configFile ? JSON.stringify(configFile) : factResolutionConfig(bindings)).toString('base64');
  const loadConfig = configFile ? `config_ref=json.loads(base64.b64decode('${encoded}'))
config_raw=(pathlib.Path('evidence')/config_ref['file']).read_bytes()
if hashlib.sha256(config_raw).hexdigest()!=config_ref['sha256']: raise ValueError('FACT_CONFIG_HASH_MISMATCH')
cfg=json.loads(config_raw)` : `cfg=json.loads(base64.b64decode('${encoded}'))`;
  return `import json,base64,pathlib,hashlib
from decimal import Decimal,ROUND_HALF_UP
${loadConfig}
facts=[]
for b in cfg['bindings']:
 b={**b,'source':cfg['sources'][b['source']]}
 raw=(pathlib.Path('evidence')/b['source']['file']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=b['source']['sha256']: raise ValueError('EVIDENCE_HASH_MISMATCH')
 doc=json.loads(raw); rows=doc
 for key in b['rows_path'].split('.'):
  if key: rows=rows[key]
 if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows): raise ValueError('FACT_ROWS_INVALID')
 def same(a,v):
  if isinstance(a,bool) or isinstance(v,bool): return type(a)==type(v) and a==v
  return a==v
 selected=[(i,r) for i,r in enumerate(rows) if all(k in r and same(r[k],v) for k,v in b['where'].items())]
 if len(selected)!=1:
  # Return a small, deterministic candidate preview so the model can add the
  # missing dimension (profile/campaign/placement/etc.) in one revision.
  # Never choose a row implicitly: ambiguity remains a hard data-integrity
  # failure, but the failure now contains enough information to converge.
  candidates=[]
  for candidate_index,candidate_row in selected[:8]:
   candidates.append({'rowIndex':candidate_index,'dimensions':{k:v for k,v in candidate_row.items() if isinstance(v,(str,int,float,bool)) or v is None}})
  raise ValueError('FACT_ROW_NOT_UNIQUE: '+b['id']+' matched '+str(len(selected))+' rows; candidates='+json.dumps(candidates,ensure_ascii=False,allow_nan=False))
 index,row=selected[0]
 if b['field'] not in row: raise ValueError('FACT_FIELD_MISSING')
 value=row[b['field']]
 if not isinstance(value,(str,int,float,bool,type(None))): raise ValueError('FACT_VALUE_NOT_SCALAR')
 if isinstance(value,(int,float)) and not isinstance(value,bool) and not Decimal(str(value)).is_finite(): raise ValueError('FACT_NON_FINITE')
 if b.get('decimals') is not None or b['suffix']:
  if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float))): raise ValueError('FACT_FORMAT_REQUIRES_NUMBER')
 if value is None: display='不可计算/未提供'
 elif b.get('decimals') is not None:
  n=Decimal(str(value)).quantize(Decimal(1).scaleb(-b['decimals']),rounding=ROUND_HALF_UP)
  display=format(n,'.'+str(b['decimals'])+'f')+b['suffix']
 else: display=str(value)+b['suffix']
 lineage=doc.get('evidence',{}) if isinstance(doc,dict) else {}
 facts.append({'id':b['id'],'evidenceId':b['evidenceId'],'sourceSha256':b['source']['sha256'],
  'rowsPath':b['rows_path'],'rowIndex':index,'selector':b['where'],'field':b['field'],'value':value,'display':display,
  'query':b['source'].get('query'),'context':b['source'].get('context'),
  'rowDimensions':{k:v for k,v in row.items() if isinstance(v,(str,int,float,bool)) or v is None},'lineage':lineage})
${compactOutput ? `# Keep complete provenance, but transport each repeated object only once.
objects=[]; indexes={}
for fact in facts:
 for key in ['query','context','rowDimensions','lineage']:
  value=fact.pop(key)
  identity=json.dumps(value,sort_keys=True,ensure_ascii=True,allow_nan=False)
  if identity not in indexes:
   indexes[identity]=len(objects); objects.append(value)
  fact[key+'Ref']=indexes[identity]
print(json.dumps({'version':1,'objects':objects,'facts':facts},ensure_ascii=True,allow_nan=False))` : 'print(json.dumps(facts,ensure_ascii=True,allow_nan=False))'}`;
}

/** Expand the host interpreter's lossless transport before hashing or review. */
export function decodeResolvedFacts(stdout: string): ResolvedFact[] {
  const result = JSON.parse(stdout);
  if (Array.isArray(result)) return result;
  if (result?.version !== 1 || !Array.isArray(result.objects) || !Array.isArray(result.facts))
    throw new Error('FACT_TRANSPORT_INVALID');
  return result.facts.map((item: Record<string, unknown>) => {
    const fact = {...item};
    for (const key of ['query', 'context', 'rowDimensions', 'lineage']) {
      const index = fact[key + 'Ref'];
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= result.objects.length)
        throw new Error('FACT_TRANSPORT_INVALID: ' + key);
      fact[key] = result.objects[index as number];
      delete fact[key + 'Ref'];
    }
    return fact as unknown as ResolvedFact;
  });
}

/** References also work in the delivery summary, using the manifest tied to the PDF hash. */
export function interpolateFacts<T>(value: T, facts: ResolvedFact[], requireUse = false): T {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const used = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const result = node.replace(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g, (_token, id: string) => {
        const fact = byId.get(id);
        if (!fact) throw new Error('FACT_REFERENCE_UNKNOWN: ' + id);
        used.add(id); return fact.display;
      });
      if (result.includes('{{fact:')) throw new Error('FACT_REFERENCE_INVALID');
      return result;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  const resolved = walk(value) as T;
  if (requireUse && facts.some(fact => !used.has(fact.id)))
    throw new Error('FACT_REFERENCE_UNUSED: ' + facts.filter(fact => !used.has(fact.id)).map(fact => fact.id).join(', '));
  return resolved;
}
