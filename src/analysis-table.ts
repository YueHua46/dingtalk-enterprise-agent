import { z } from 'zod';

const field = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const tableAnalysisSchema = z.strictObject({
  evidenceId: z.string().min(1),
  rows_path: z.string().default('data.rows'),
  group_by: z.array(field).max(12).default([]),
  sums: z.array(field).max(30).default([]),
  ratios: z.array(z.strictObject({name: field, numerator: field, denominator: field,
    scale: z.number().finite().default(1)})).max(15).default([]),
  order_by: z.strictObject({field, descending: z.boolean().default(true)}).optional(),
  limit: z.number().int().min(1).max(100).default(30),
  purpose: z.string().max(200).optional()
});
export const tableAnalysisTool = {type: 'function', name: 'table',
  description: '对已保存证据表做分组求和、比率和排序，无需写 Python。evidenceId 与 rows_path 来自 evidence/index.json 的 tables。sums 为空时保留原行排序；有 sums 时按 group_by 聚合（自行保留币种/来源等不可相加维度）。ratios 引用现有数字列或求和列，百分数 scale=100。缺失不当零、零分母为 null。结果保存为新的计算证据，可直接用于 PDF 和聊天。已有服务端指标直接引用；复杂筛选或分析继续用 analysis.python。',
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
for ratio in cfg['ratios']: needed.update([ratio['numerator'],ratio['denominator']])
if rows and not needed.issubset(fields): raise ValueError('UNKNOWN_FIELDS: '+','.join(sorted(needed-fields)))
def number(v):
    if v is None: return None
    if isinstance(v,bool) or not isinstance(v,(int,float,str,Decimal)): raise ValueError('NON_NUMERIC_VALUE')
    n=Decimal(str(v))
    if not n.is_finite(): raise ValueError('NON_FINITE_VALUE')
    return n
result=[]
if cfg['sums']:
    groups={}
    for row in rows:
        key=json.dumps([row.get(k) for k in cfg['group_by']],ensure_ascii=False,sort_keys=True)
        groups.setdefault(key,[]).append(row)
    for key,group in groups.items():
        out=dict(zip(cfg['group_by'],json.loads(key)))
        out['_input_rows']=len(group)
        out['_missing_counts']={}
        for name in cfg['sums']:
            values=[number(r.get(name)) for r in group]
            missing=sum(v is None for v in values)
            out['_missing_counts'][name]=missing
            out[name]=None if missing else sum(values,Decimal(0))
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
    result=sorted(nonnull,key=lambda r:number(r[order['field']]),reverse=order['descending'])+empty
def encode(v):
    if isinstance(v,Decimal): return float(v)
    raise TypeError(type(v).__name__)
print(json.dumps({'dataset':'calculation.table','evidence':{'source_evidence_id':cfg['evidenceId'],'source_sha256':digest,'operation':cfg},'data':{'rows':result[:cfg['limit']],'coverage':{'input_rows':len(rows),'total':len(result),'returned':min(len(result),cfg['limit']),'has_more':len(result)>cfg['limit'],'basis':'all rows of selected saved evidence; not proof of upstream completeness'},'source_context':{k:metadata.get(k) for k in ['dataset','scope','evidence']},'source_data_context':{k:source_data.get(k) for k in ['period','coverage','dimensions','metric_semantics','semantics','metric_units','field_semantics','annotation_provenance','dimension_field_coverage']} }},ensure_ascii=False,default=encode,allow_nan=False))
`;
}
