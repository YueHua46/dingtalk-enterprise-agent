import type { DocumentRender } from './document-render.js';
import type { EvidenceFileEntry } from './evidence-manifest.js';

/** Protect factual values structurally; semantic review still checks scope,
 * assumptions, causal claims and whether an observation was disguised as advice. */
export function assertDocumentGrounding(payload: DocumentRender, sources: EvidenceFileEntry[]): void {
  const numeric = sources.some(s => ['observation','calculation'].includes(s.kind ?? '')
    && s.tables?.some(t => t.rows > 0 && Object.values(t.fields).some(types => types.includes('number'))));
  const bindings = new Set<string>();
  for (const fact of payload.fact_bindings ?? []) {
    if (bindings.has(fact.id)) throw new Error('FACT_ID_DUPLICATE');
    bindings.add(fact.id);
  }
  const errors: {code:string;path:string;snippet:string;unboundNumbers?:string[]}[] = [];
  let total = 0;
  const add = (code:string, path:string[], node:unknown, unboundNumbers?:string[]) => {
    total++;
    if (errors.length < 40) errors.push({code,path:'/' + path.map(p=>p.replace(/~/g,'~0').replace(/\//g,'~1')).join('/'),snippet:String(node).slice(0,180),...(unboundNumbers?{unboundNumbers}:{})});
  };
  const walk = (node:unknown, path:string[], allowNumber = false): void => {
    if (typeof node === 'string') {
      const literal = node.replace(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g, (token,id:string) => {
        if (!bindings.has(id)) add('FACT_REFERENCE_UNKNOWN',path,token);
        return '';
      });
      if (literal.includes('{{fact:')) add('FACT_REFERENCE_INVALID',path,node);
      if (numeric && !allowNumber && /\p{Number}/u.test(literal)) add('DOCUMENT_LITERAL_FACT_REQUIRES_BINDING',path,node,
        [...new Set(literal.match(/\p{Number}+(?:[.,]\p{Number}+)*(?:%|％)?/gu) ?? [])].slice(0,12));
    } else if (typeof node === 'number' && numeric && !allowNumber) add('DOCUMENT_LITERAL_FACT_REQUIRES_BINDING',path,node);
    else if (Array.isArray(node)) node.forEach((v,i)=>walk(v,[...path,String(i)],allowNumber));
    else if (node && typeof node === 'object') Object.entries(node).forEach(([k,v])=>walk(v,[...path,k],allowNumber));
  };
  // Scope metadata can contain user-requested dates and IDs. It is still
  // interpolated and reviewed, but is not an account metric.
  walk(payload.document.title,['document','title'],true);
  if (payload.document.subtitle) walk(payload.document.subtitle,['document','subtitle'],true);
  walk(payload.document.metadata,['document','metadata'],true);
  walk(payload.document.sources,['document','sources'],true);
  payload.document.blocks.forEach((block,i)=> {
    const prefix = ['document','blocks',String(i)];
    const {id: _id, type: _type, ...body} = block;
    for (const [key,value] of Object.entries(body)) {
      if (['source','category_field','kind','tone'].includes(key)) continue;
      if ((key === 'columns' || key === 'series') && Array.isArray(value)) {
        value.forEach((col,j)=>walk((col as {label:string}).label,[...prefix,key,String(j),'label']));
      } else if (block.type === 'actions' && key === 'items') {
        block.items.forEach((action,j)=>Object.entries(action).forEach(([field,v])=>
          walk(v,[...prefix,'items',String(j),field],['priority','proposal','conditions','review','confirmation'].includes(field))));
      } else walk(value,[...prefix,key]);
    }
  });
  if (total) throw new Error(`${errors[0]!.code}\n${JSON.stringify({errors,total,
    next:'使用 artifact.revise_document 的 draft_id + changes 按 JSON pointer 修正，不要重写全文。'})}`);
}
