import type { DocumentRender } from './document-render.js';
import type { EvidenceFileEntry } from './evidence-manifest.js';

// Source schema fields, not words inferred from the user's request. A business
// object must retain its saved identity; a translated label is not that identity.
const identityFields = new Set(['keyword_text','customer_search_term','query','target_text','targeting_text',
  'campaign_name','ad_group_name','asin','target_asin','keyword_id','target_id','campaign_id','ad_group_id',
  'sku','msku','product_name','store_name']);

/** Protect factual values structurally; semantic review still checks scope,
 * assumptions, causal claims and whether an observation was disguised as advice. */
export function assertDocumentGrounding(payload: DocumentRender, sources: EvidenceFileEntry[]): void {
  const numeric = sources.some(s => ['observation','calculation'].includes(s.kind ?? '')
    && s.tables?.some(t => t.rows > 0 && Object.values(t.fields).some(types => types.includes('number'))));
  const bindings = new Set<string>();
  const objectBindings = new Set((payload.fact_bindings ?? []).filter(fact => identityFields.has(fact.field)
    && sources.some(source => source.evidenceId === fact.evidenceId && source.kind === 'observation'
      && source.tables?.some(table => table.path === fact.rows_path && Object.hasOwn(table.fields,fact.field))))
    .map(fact => fact.id));
  const hasBusinessObjects = sources.some(source => source.kind === 'observation'
    && source.tables?.some(table => table.rows > 0 && Object.keys(table.fields).some(field => identityFields.has(field))));
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
        block.items.forEach((action,j)=> {
          if (hasBusinessObjects && action.object && ![...action.object.matchAll(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g)]
            .some(match => objectBindings.has(match[1]!))) {
            add('DOCUMENT_OBJECT_REQUIRES_SOURCE_IDENTITY',[...prefix,'items',String(j),'object'],action.object);
          }
          // Advice fields allow proposed values, but an explicitly labelled
          // current/original value is still an observation. Do not let moving
          // it into proposal bypass exact-value binding. Inspect before the
          // general walker strips placeholders.
          if (hasBusinessObjects) for (const field of ['proposal','conditions','review'] as const) {
            const value = action[field];
            if (value && /(?:当前|原|现有)\s*(?:实际|平均)?\s*(?:CPC|ACoS|CVR|CTR|竞价|出价|日预算|预算|花费|销售额|订单数|点击数|曝光量)\s*[：:=]?\s*[€$¥￥]?\s*\p{Number}/iu.test(value))
              add('DOCUMENT_CURRENT_VALUE_REQUIRES_BINDING',[...prefix,'items',String(j),field],value);
          }
          Object.entries(action).forEach(([field,v])=>
            walk(v,[...prefix,'items',String(j),field],['priority','proposal','conditions','review','confirmation'].includes(field)));
        });
      } else walk(value,[...prefix,key]);
    }
  });
  if (total) throw new Error(`${errors[0]!.code}\n${JSON.stringify({errors,total,
    next:'按 errors.path 局部修正，不要重写全文或重新取数。DOCUMENT_LITERAL_FACT_REQUIRES_BINDING：正文、标题、note、evidence 中每个观测数值都改用 {{fact:id}}，在 fact_bindings 中绑定真实 evidenceId、rows_path、where、field；对象名中含数字也整体绑定。用户给出的日期和ASIN可放 subtitle/metadata，正文引用仍需证据绑定。DOCUMENT_OBJECT_REQUIRES_SOURCE_IDENTITY：即使已写德语原名也须改成 observation 来源的 keyword_text/customer_search_term/target_text/campaign_name/ad_group_name/asin 等身份字段绑定，不能用指标绑定冒充对象；匹配方式和中文解释另列。没有来源的毛利率、盈利判断等不要补造；删除无依据断言或说明未知。使用 artifact.revise_document 的 draft_id + changes 修正；新增绑定放 fact_bindings。'})}`);
}
