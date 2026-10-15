import { createHash } from 'node:crypto';
import type { CodexClientLike } from './codex-client.js';
import type { EvidenceFileEntry } from './evidence-manifest.js';
import { decodeResolvedFacts, factResolutionCode, factResolutionConfig, prepareFactBindings, interpolateFacts,
  type FactBinding, type ResolvedFact } from './evidence-facts.js';
import { compiledDocumentSchema, type DocumentRender } from './document-render.js';
import { assertDocumentGrounding } from './document-grounding.js';
import {documentProvenance,factUses} from './document-provenance.js';

/** Reuse the same exact saved-value interpreter for legacy and generic documents. */
export async function resolveDocumentFacts(client: CodexClientLike, taskId:string, bindings:FactBinding[], sources:EvidenceFileEntry[]):Promise<ResolvedFact[]> {
  if (!bindings.length) return [];
  if (!client.runPython || !client.usesWorker?.(taskId)) throw new Error('ANALYSIS_RUNTIME_UNAVAILABLE');
  const prepared = prepareFactBindings(bindings,sources);
  let ref:{file:string;sha256:string} | undefined;
  if (client.writeEvidence) {
    const config = factResolutionConfig(prepared);
    const digest = createHash('sha256').update(config).digest('hex');
    ref = {file:`report-facts-${digest}.json`,sha256:digest};
    await client.writeEvidence(taskId,ref.file,config);
  }
  const result = await client.runPython(taskId,factResolutionCode(prepared,ref,true));
  if (result.exitCode !== 0 || result.timedOut) throw new Error('FACT_RESOLUTION_FAILED: ' + (result.stderr.trim() || 'PYTHON_TIMEOUT_OR_EXIT'));
  return decodeResolvedFacts(result.stdout);
}

/** Materializes table/chart blocks in place. Selection never aggregates,
 * sorts, coerces strings into numbers, or substitutes zero for missing data. */
export async function compileDocument(client:CodexClientLike,taskId:string,payload:DocumentRender,sources:EvidenceFileEntry[]) {
  assertDocumentGrounding(payload,sources);
  const facts = await resolveDocumentFacts(client,taskId,payload.fact_bindings ?? [],sources);
  // Only content is interpolated: evidence IDs, selectors and field names are
  // exact references and must never be rewritten by presentation placeholders.
  const document = structuredClone(payload.document);
  document.title = interpolateFacts(document.title,facts);
  if (document.subtitle) document.subtitle = interpolateFacts(document.subtitle,facts);
  if (document.metadata) document.metadata = interpolateFacts(document.metadata,facts);
  if (document.sources) document.sources = interpolateFacts(document.sources,facts);
  const content = document.blocks.map(block => {
    if (block.type !== 'table' && block.type !== 'chart') return interpolateFacts(block,facts);
    const {source, ...body} = block;
    return {...interpolateFacts(body,facts),...(source ? {source} : {})};
  });
  // Check unused bindings across all text without touching the reference selectors.
  interpolateFacts({...payload.document,blocks:payload.document.blocks.map(b=>{
    if (b.type === 'chart' || b.type === 'table') {const {source:_source,...body}=b;return body;}
    return b;
  })},facts,true);
  const bindings = document.blocks.flatMap((block,index)=> {
    if ((block.type !== 'table' && block.type !== 'chart') || !block.source) return [];
    const source = sources.find(s=>s.evidenceId === block.source!.evidenceId);
    const table = source?.tables?.find(t=>t.path === block.source!.rows_path);
    if (!source?.sha256 || !['observation','calculation'].includes(source.kind ?? '') || !table) throw new Error('DOCUMENT_SOURCE_UNAVAILABLE: ' + block.id);
    const fields = block.type === 'table' ? block.columns.map(c=>c.field) : [block.category_field,...block.series.map(s=>s.field)];
    for (const field of [...fields,...Object.keys(block.source.where)]) {
      if (!Object.prototype.hasOwnProperty.call(table.fields,field)) throw new Error(`DOCUMENT_FIELD_UNAVAILABLE: ${block.id}.${field}; available=${Object.keys(table.fields).join(',')}`);
    }
    return [{...block.source,index,blockId:block.id,type:block.type,fields,file:source.file,sha256:source.sha256}];
  });
  const tables:unknown[] = [];
  if (bindings.length) {
    if (!client.runPython || !client.writeEvidence || !client.usesWorker?.(taskId)) throw new Error('ANALYSIS_RUNTIME_UNAVAILABLE');
    const raw = JSON.stringify(bindings);
    const digest = createHash('sha256').update(raw).digest('hex');
    const file = `document-data-${digest}.json`;
    await client.writeEvidence(taskId,file,raw);
    const result = await client.runPython(taskId,`import json,pathlib,hashlib,math
raw=(pathlib.Path('evidence')/'${file}').read_bytes()
if hashlib.sha256(raw).hexdigest()!='${digest}': raise ValueError('DOCUMENT_CONFIG_HASH_MISMATCH')
results=[]
for b in json.loads(raw):
 raw=(pathlib.Path('evidence')/b['file']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=b['sha256']: raise ValueError('EVIDENCE_HASH_MISMATCH')
 rows=json.loads(raw)
 for key in b['rows_path'].split('.'):
  if key: rows=rows[key]
 if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows): raise ValueError('DOCUMENT_ROWS_INVALID')
 def same(a,v):
  if isinstance(a,bool) or isinstance(v,bool): return type(a)==type(v) and a==v
  return a==v
 matched=[(i,r) for i,r in enumerate(rows) if all(k in r and same(r[k],v) for k,v in b['where'].items())]
 selected=matched[b['offset']:b['offset']+b['limit']]
 values=[]
 for i,row in selected:
  if any(f not in row for f in b['fields']): raise ValueError('DOCUMENT_FIELD_MISSING: '+b['blockId'])
  cells=[row[f] for f in b['fields']]
  if any(isinstance(v,(dict,list)) for v in cells): raise ValueError('DOCUMENT_CELL_NOT_SCALAR')
  if b['type']=='chart' and any(v is not None and (isinstance(v,bool) or not isinstance(v,(int,float))) for v in cells[1:]): raise ValueError('DOCUMENT_CHART_REQUIRES_NUMBER')
  if any(isinstance(v,float) and not math.isfinite(v) for v in cells): raise ValueError('DOCUMENT_NON_FINITE')
  values.append(cells)
 results.append({'index':b['index'],'sourceRows':len(rows),'matchedRows':len(matched),'rowIndices':[i for i,r in selected],'values':values})
print(json.dumps(results,ensure_ascii=True,allow_nan=False))`);
    if (result.exitCode !== 0 || result.timedOut) throw new Error('DOCUMENT_EVIDENCE_READ_FAILED: ' + result.stderr);
    const results = JSON.parse(result.stdout) as Array<{index:number;sourceRows:number;matchedRows:number;rowIndices:number[];values:Array<Array<string|number|boolean|null>>}>;
    if (results.length !== bindings.length) throw new Error('DOCUMENT_EVIDENCE_RESULT_INVALID');
    results.forEach((result,i)=> {
      const binding = bindings[i]!;
      const block = document.blocks[binding.index]!;
      if (result.index !== binding.index || (block.type !== 'table' && block.type !== 'chart')) throw new Error('DOCUMENT_EVIDENCE_RESULT_INVALID');
      const source = sources.find(s=>s.evidenceId === binding.evidenceId)!;
      const coverage = `显示 ${result.values.length} 条 / 匹配 ${result.matchedRows} 条 / 引用结果 ${result.sourceRows} 条；统计范围以来源为准。`;
      const {source:_source,...body} = content[binding.index] as typeof block;
      if (block.type === 'table') content[binding.index] = {...body,rows:result.values,coverage} as never;
      else {
        if (!result.values.length) throw new Error('DOCUMENT_CHART_EMPTY: ' + block.id + '; use a callout for missing data');
        if (block.kind === 'line' && result.values.every(row=>typeof row[0]==='string' && /^\d{4}-\d{2}-\d{2}$/.test(row[0]))
          && result.values.some((row,index)=>index>0 && String(row[0])<=String(result.values[index-1]![0]))) {
          throw new Error('DOCUMENT_CHART_DATE_ORDER: '+block.id+'; sort dates ascending with analysis.table order_by before rendering a line chart');
        }
        const {category_field:_category,series:_series,...chartBody} = body as Omit<typeof block,'source'>;
        content[binding.index] = {...chartBody,categories:result.values.map(r=>r[0]!),
          series: block.series.map((s,j)=>({label:interpolateFacts(s.label,facts),values:result.values.map(r=>r[j+1] as number|null)})),coverage} as never;
      }
      tables.push({blockId:block.id,type:block.type,evidenceId:binding.evidenceId,sourceSha256:binding.sha256,
        rowsPath:binding.rows_path,fields:binding.fields,selectedRows:result.values.length,sourceRows:result.sourceRows,
        selectedRowValues:result.values,selection:{where:binding.where,offset:binding.offset,limit:binding.limit,rowIndices:result.rowIndices,matchedRows:result.matchedRows},
        query:source.query,context:source.context,valuesSha256:createHash('sha256').update(JSON.stringify(result.values)).digest('hex'),
        verification:'host_read_exact_saved_rows_without_transcription'});
    });
  }
  const uses=document.blocks.flatMap(block=>factUses(block.id,block,facts));
  // Scope/title facts are cited too, even when the model places them outside a block.
  uses.push(...factUses(document.blocks[0]!.id,{title:payload.document.title,subtitle:payload.document.subtitle,metadata:payload.document.metadata},facts));
  for(const binding of bindings)uses.push({blockId:binding.blockId,evidenceId:binding.evidenceId,
    rowsPath:binding.rows_path,fields:binding.fields,selector:binding.where});
  const provenance=documentProvenance(sources,uses);
  const compiled = compiledDocumentSchema.parse({format:payload.format,theme:payload.theme,detail:payload.detail,
    document:{...document,blocks:content.map(b=>({...b,sourceRefs:provenance.blockRefs[b.id]})),references:provenance.references}});
  return {compiled,facts,tables};
}
