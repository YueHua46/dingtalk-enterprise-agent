import { z } from 'zod';

const field = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const condition = z.strictObject({field, op:z.enum(['eq','ne','gt','gte','lt','lte']),
  value:z.union([z.string(),z.number().finite(),z.boolean(),z.null()]).optional(), other_field:field.optional()})
  .superRefine((v,ctx)=>{if ((v.value !== undefined) === (v.other_field !== undefined)) ctx.addIssue({code:'custom',message:'Specify exactly one value or other_field'});});
export const tableAnalysisSchema = z.strictObject({
  evidenceId: z.string().min(1),
  rows_path: z.string().default('data.rows'),
  group_by: z.array(field).max(12).default([]),
  filters: z.array(condition).max(20).default([]),
  filter_mode:z.enum(['all','any']).default('all'),
  row_count:field.optional(),
  sums: z.array(field).max(30).default([]),
  ratios: z.array(z.strictObject({name: field, numerator: field, denominator: field,
    scale: z.number().finite().default(1)})).max(15).default([]),
  order_by: z.strictObject({field, descending: z.boolean().default(true)}).optional(),
  limit: z.number().int().min(1).max(100).default(30),
  purpose: z.string().max(200).optional()
});
export const tableAnalysisTool = {type: 'function', name: 'table',
  description: '对已保存证据表做确定性筛选、分组、计数、求和、比率和排序。filters={field,op:eq/ne/gt/gte/lt/lte,value或other_field}，filter_mode=all/any；row_count指定计数输出列。可比较两字段，避免手算分类数。evidenceId与rows_path来自证据索引；有sums或row_count时按group_by聚合，必须保留币种/来源等不可相加维度。ratios百分数scale=100；缺失不当零、零分母null。结果带原查询、操作与哈希血缘，用于evidence_tables或fact_bindings；不支持无证据关联或跨表join。复杂分析继续analysis.python。',
  inputSchema: z.toJSONSchema(tableAnalysisSchema)};

/** No generated expressions: all operations and column access are interpreted as data. */
export function tableAnalysisCode(spec: z.infer<typeof tableAnalysisSchema>, source: {file: string; sha256?: string}) {
  const encoded = Buffer.from(JSON.stringify({...spec, source})).toString('base64');
  return `import json, base64, hashlib, decimal, pathlib
from decimal import Decimal
cfg=json.loads(base64.b64decode('${encoded}'))
path=pathlib.Path('evidence')/cfg['source']['file']
raw=path.read_bytes()
digest=hashlib.sha256(raw).hexdigest()
if cfg['source'].get('sha256') and digest!=cfg['source']['sha256']: raise ValueError('EVIDENCE_HASH_MISMATCH')
doc=json.loads(raw)
metadata=doc if isinstance(doc,dict) else {}
source_data=metadata.get('data') if isinstance(metadata.get('data'),dict) else {}
rows=doc
for part in cfg['rows_path'].split('.'):
    if part: rows=rows[part]
if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows): raise ValueError('ROWS_NOT_OBJECT_ARRAY')
fields=set().union(*(r.keys() for r in rows)) if rows else set()
needed=set(cfg['group_by']+cfg['sums'])
for f in cfg['filters']:
 needed.add(f['field'])
 if f.get('other_field'): needed.add(f['other_field'])
aggregated=bool(cfg['sums'] or cfg.get('row_count'))
reserved={'_input_rows','_missing_counts'}
base_outputs=cfg['group_by']+cfg['sums']+([cfg['row_count']] if cfg.get('row_count') else [])
ratio_names=[r['name'] for r in cfg['ratios']]
if aggregated and (len(set(base_outputs))!=len(base_outputs) or reserved.intersection(base_outputs)): raise ValueError('OUTPUT_FIELD_COLLISION')
if len(set(ratio_names))!=len(ratio_names) or reserved.intersection(ratio_names): raise ValueError('OUTPUT_FIELD_COLLISION')
if set(ratio_names).intersection(set(base_outputs) if aggregated else fields): raise ValueError('OUTPUT_FIELD_COLLISION')
if cfg.get('row_count') in fields: raise ValueError('OUTPUT_FIELD_COLLISION')
available=set(base_outputs) if aggregated else fields
for ratio in cfg['ratios']:
 inputs={ratio['numerator'],ratio['denominator']}
 if not inputs.issubset(available): raise ValueError('RATIO_INPUT_NOT_IN_OUTPUT')
 available.add(ratio['name'])
if rows and not needed.issubset(fields): raise ValueError('UNKNOWN_FIELDS: '+','.join(sorted(needed-fields)))
def number(v):
    if v is None: return None
    if isinstance(v,bool) or not isinstance(v,(int,float,str,Decimal)): raise ValueError('NON_NUMERIC_VALUE')
    n=Decimal(str(v))
    if not n.is_finite(): raise ValueError('NON_FINITE_VALUE')
    return n
result=[]
input_rows=len(rows)
def matches(row,f):
 if f['field'] not in row or f.get('other_field') and f['other_field'] not in row: return False
 a=row.get(f['field']); b=row.get(f['other_field']) if f.get('other_field') else f.get('value')
 equal=(type(a)==type(b) or isinstance(a,(int,float)) and not isinstance(a,bool) and isinstance(b,(int,float)) and not isinstance(b,bool)) and a==b
 if f['op']=='eq': return equal
 if f['op']=='ne': return not equal
 if a is None or b is None: return False
 a,b=number(a),number(b)
 return {'gt':a>b,'gte':a>=b,'lt':a<b,'lte':a<=b}[f['op']]
if cfg['filters']:
 rows=[r for r in rows if (all if cfg['filter_mode']=='all' else any)(matches(r,f) for f in cfg['filters'])]
if cfg['sums'] or cfg.get('row_count'):
    groups={}
    for row in rows:
        key=json.dumps([row.get(k) for k in cfg['group_by']],ensure_ascii=False,sort_keys=True)
        groups.setdefault(key,[]).append(row)
    for key,group in groups.items():
        out=dict(zip(cfg['group_by'],json.loads(key)))
        out['_input_rows']=len(group)
        if cfg.get('row_count'): out[cfg['row_count']]=len(group)
        out['_missing_counts']={}
        for name in cfg['sums']:
            values=[number(r.get(name)) for r in group]
            missing=sum(v is None for v in values)
            out['_missing_counts'][name]=missing
            out[name]=None if missing else sum(values,Decimal(0))
        result.append(out)
    if not rows and not cfg['group_by']:
        out={'_input_rows':0,'_missing_counts':{}}
        if cfg.get('row_count'): out[cfg['row_count']]=0
        for name in cfg['sums']: out[name]=None
        result.append(out)
else: result=[dict(r) for r in rows]
for out in result:
    for ratio in cfg['ratios']:
        if ratio['numerator'] not in out or ratio['denominator'] not in out: raise ValueError('RATIO_INPUT_NOT_IN_OUTPUT')
        a,b=number(out.get(ratio['numerator'])),number(out.get(ratio['denominator']))
        out[ratio['name']]=None if a is None or b is None or b==0 else a/b*Decimal(str(ratio['scale']))
order=cfg.get('order_by')
if order:
    if result and order['field'] not in result[0]: raise ValueError('UNKNOWN_SORT_FIELD')
    nonnull=[r for r in result if r.get(order['field']) is not None]
    empty=[r for r in result if r.get(order['field']) is None]
    values=[r[order['field']] for r in nonnull]
    try:
        for v in values: number(v)
        sort_key=lambda r:number(r[order['field']])
    except (ValueError,decimal.InvalidOperation):
        if not all(isinstance(v,str) for v in values): raise ValueError('MIXED_SORT_TYPES: use a uniformly numeric or text column')
        sort_key=lambda r:r[order['field']]
    result=sorted(nonnull,key=sort_key,reverse=order['descending'])+empty
def encode(v):
    if isinstance(v,Decimal): return float(v)
    raise TypeError(type(v).__name__)
print(json.dumps({'dataset':'calculation.table','evidence':{'source_evidence_id':cfg['evidenceId'],'source_sha256':digest,'operation':cfg},'data':{'rows':result[:cfg['limit']],'coverage':{'input_rows':input_rows,'selected_rows':len(rows),'total':len(result),'returned':min(len(result),cfg['limit']),'has_more':len(result)>cfg['limit'],'basis':'all rows of selected saved evidence; not proof of upstream completeness'},'dimensions':cfg['group_by'],'source_context':{k:metadata.get(k) for k in ['dataset','scope','evidence']},'source_data_context':{k:source_data.get(k) for k in ['period','coverage','dimensions','metric_semantics','semantics','metric_units','field_semantics','annotation_provenance','dimension_field_coverage']} }},ensure_ascii=False,default=encode,allow_nan=False))
`;
}
