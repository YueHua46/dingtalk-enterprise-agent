import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {documentRenderSchema,compiledDocumentSchema} from '../src/document-render.js';
import {compileDocument} from '../src/document-compiler.js';
import {assertDocumentGrounding} from '../src/document-grounding.js';
import {applyDocumentRevision} from '../src/document-revision.js';
import {renderDocumentHtml} from '../src/document-html.js';
import {describeEvidence,type EvidenceFileEntry} from '../src/evidence-manifest.js';
import {executionLane} from '../src/execution-budget.js';
import {enterpriseTools} from '../src/codex-client.js';

const draft=()=>documentRenderSchema.parse({format:'pdf',document:{title:'广告简报',blocks:[
  {id:'next',type:'actions',items:[{proposal:'先观察，再评估调整'}]},
  {id:'finding',type:'summary',text:'当前样本不足，暂不调整'}
]}});
const source=(raw:string):EvidenceFileEntry=>({file:'data.json',evidenceId:'ads',capabilityId:'crossborderops.ads.metrics',
  arguments:'{}',query:{marketplace:'UK'},kind:'observation',sha256:createHash('sha256').update(raw).digest('hex'),...describeEvidence(raw)});
const numericSources=[source(JSON.stringify({data:{rows:[{spend:12}]}}))];

describe('composable PDF document contract',()=>{
  it('advertises document creation while retaining only existing legacy draft revision',()=>{
    const artifact=enterpriseTools.find(namespace=>namespace.name==='artifact')!;
    const names=artifact.tools.map(tool=>tool.name);
    expect(names).toContain('render_document');
    expect(names).toContain('revise_document');
    expect(names).toContain('revise_report');
    expect(names).not.toContain('render_report');
  });
  it('allows a short document with arbitrary block ordering and no country, cover or fixed chapters',()=>{
    expect(draft()).toMatchObject({theme:'ops-clean',detail:'brief',document:{blocks:[{type:'actions'},{type:'summary'}]}});
    expect(executionLane('artifact','render_document')).toBe('rendering');
    expect(executionLane('artifact','revise_document')).toBe('rendering');
  });
  it('keeps highlights short while allowing independently composed explanations, tables and actions',()=>{
    const withBlocks=(blocks:unknown[])=>({...draft(),document:{title:'自由编排',blocks}});
    for(const type of ['summary','callout']) {
      for(const text of ['事项甲\n事项乙','事项甲\\n事项乙','事项甲\\r\\n事项乙','说明'.repeat(241)])
        expect(documentRenderSchema.safeParse(withBlocks([{id:'h',type,text}])).success).toBe(false);
    }
    expect(documentRenderSchema.safeParse(withBlocks([
      {id:'next',type:'actions',items:[{proposal:'核实后再评估'}]},
      {id:'detail',type:'text',paragraphs:['独立解释甲','独立解释乙']},
      {id:'compare',type:'table',columns:[{field:'period',label:'期间'}],rows:[['前期'],['本期']]}
    ])).success).toBe(true);
    // Resolved long source names must not be silently clipped by the renderer.
    expect(compiledDocumentSchema.safeParse(withBlocks([{id:'h',type:'summary',text:'名称'.repeat(300)}])).success).toBe(true);
    expect(documentRenderSchema.safeParse(withBlocks([{id:'p',type:'text',paragraphs:['甲\\n乙']}])).success).toBe(false);
  });
  it('rejects raw HTML/code/paths, literal chart data, duplicate ids and invalid tables',()=>{
    const base=draft();
    for(const extra of [{html:'<script/>'},{path:'/tmp/result.pdf'},{script:'process.exit()'}])
      expect(documentRenderSchema.safeParse({...base,...extra}).success).toBe(false);
    const withBlocks=(blocks:unknown[])=>({...base,document:{...base.document,blocks}});
    expect(documentRenderSchema.safeParse(withBlocks([base.document.blocks[0],base.document.blocks[0]])).success).toBe(false);
    expect(documentRenderSchema.safeParse(withBlocks([{id:'t',type:'table',columns:[{field:'a',label:'A'}],rows:[[1,2]]}])).success).toBe(false);
    expect(documentRenderSchema.safeParse(withBlocks([{id:'c',type:'chart',kind:'bar',categories:['A'],series:[{label:'value',values:[1]}]}])).success).toBe(false);
    expect(documentRenderSchema.safeParse(withBlocks([{id:'t',type:'table',columns:[{field:'{{fact:field}}',label:'A'}],rows:[['x']]}])).success).toBe(false);
    expect(compiledDocumentSchema.safeParse(withBlocks([{id:'c',type:'chart',kind:'line',categories:['A'],series:[{label:'spend',values:[1,2]}]}])).success).toBe(false);
  });
  it('binds numeric observations but allows explicit numeric proposals and scope metadata',()=>{
    const payload=draft();
    payload.document.title='英国站 2026-10-15';
    payload.document.blocks=[{id:'advice',type:'actions',items:[{proposal:'建议观察 7 天',review:'建议累计 20 次点击后复查'}]}];
    expect(()=>assertDocumentGrounding(payload,numericSources)).not.toThrow();
    payload.document.blocks.push({id:'fact',type:'summary',text:'花费 12 英镑'});
    expect(()=>assertDocumentGrounding(payload,numericSources)).toThrow('DOCUMENT_LITERAL_FACT_REQUIRES_BINDING');
    payload.document.blocks=[{id:'fact',type:'summary',text:'花费 {{fact:spend}} 英镑'}];
    expect(()=>assertDocumentGrounding(payload,[])).toThrow('FACT_REFERENCE_UNKNOWN');
    payload.fact_bindings=[{id:'spend',evidenceId:'ads',rows_path:'data.rows',where:{},field:'spend',suffix:''}];
    expect(()=>assertDocumentGrounding(payload,numericSources)).not.toThrow();
  });
  it('applies revisions atomically, retains ids and rejects prototype/path escapes',()=>{
    const payload=draft();
    const revised=applyDocumentRevision(payload,{draft_id:'x',changes:[
      {path:'/document/blocks/1/text',value:'重新观察'},
      {path:'/document/blocks/-',value:{id:'more',type:'text',paragraphs:['补充说明']}}
    ]});
    expect(revised.document.blocks.map(b=>b.id)).toEqual(['next','finding','more']);
    expect((payload.document.blocks[1] as any).text).toBe('当前样本不足，暂不调整');
    for(const path of ['/document/__proto__/polluted','/document/constructor/x','/document/blocks/99/text','/document','/theme'])
      expect(()=>applyDocumentRevision(payload,{draft_id:'x',changes:[{path,value:'x'}]})).toThrow();
    expect(()=>applyDocumentRevision(payload,{draft_id:'x',changes:[{path:'/document/blocks',value:[]}]})).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });
  it('identifies late unbound numbers without weakening evidence binding',()=>{
    const payload=draft();
    payload.document.blocks=[{id:'finding',type:'text',paragraphs:['说明'.repeat(120)+'花费 12.50，变化 3%，共 ４ 次']}];
    try { assertDocumentGrounding(payload,numericSources); throw new Error('expected grounding rejection'); }
    catch(error) {
      const message=(error as Error).message;
      expect(message).toContain('DOCUMENT_LITERAL_FACT_REQUIRES_BINDING');
      const detail=JSON.parse(message.slice(message.indexOf('\n')+1));
      expect(detail.errors[0]).toMatchObject({path:'/document/blocks/0/paragraphs/0',unboundNumbers:['12.50','3%','４']});
    }
  });
  it('prunes unused fact bindings after a local revision',()=>{
    const payload=draft();
    payload.document.blocks[1]={id:'finding',type:'summary',text:'{{fact:spend}}'};
    payload.fact_bindings=[{id:'spend',evidenceId:'ads',rows_path:'data.rows',where:{},field:'spend',suffix:''}];
    expect(applyDocumentRevision(payload,{draft_id:'x',changes:[{path:'/document/blocks/1/text',value:'样本不足'}]}).fact_bindings).toEqual([]);
  });
  it('escapes untrusted strings and preserves long chart labels through a full key',()=>{
    const html=renderDocumentHtml(compiledDocumentSchema.parse({format:'pdf',document:{title:'<script>alert(1)</script>',blocks:[
      {id:'long',type:'chart',kind:'line',categories:['sehr-langer-deutscher-Kampagnenname-完整名称','短名'],series:[{label:'花费',values:[null,0]}]}
    ]}}));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('sehr-langer-deutscher-Kampagnenname-完整名称');
    expect(html).toContain('default-src');
    expect(html).not.toContain('M55,'); // null is not converted into zero
  });
  it('formats table precision without changing identifiers or hiding small values',()=>{
    const html=renderDocumentHtml(compiledDocumentSchema.parse({format:'pdf',document:{title:'显示精度',blocks:[
      {id:'t',type:'table',columns:[{field:'id',label:'活动ID'},{field:'rate',label:'ACOS'},{field:'tiny',label:'比率'}],
        rows:[['120507115861721',62.189660420018264,0.00001234]]}
    ]}}));
    expect(html).toContain('120507115861721');
    expect(html).toContain('62.19');
    expect(html).not.toContain('62.189660420018264');
    expect(html).toContain('0.0000123');
    expect(html).toContain('<colgroup>');
    expect(html).toContain('class="identifier">120507115861721</td>');
  });
  it('spaces date ticks without an adjacent label colliding with the endpoint',()=>{
    const categories=Array.from({length:14},(_,i)=>`2026-10-${String(i+1).padStart(2,'0')}`);
    const html=renderDocumentHtml(compiledDocumentSchema.parse({format:'pdf',document:{title:'日期轴',blocks:[
      {id:'trend',type:'chart',kind:'line',categories,series:[{label:'花费',values:categories.map((_,i)=>i)}]}
    ]}}));
    const labels=[...html.matchAll(/y="268"[^>]*>([^<]+)<\/text>/g)].map(m=>m[1]);
    expect(labels).toHaveLength(6);
    expect(labels[0]).toBe(categories[0]);
    expect(labels.at(-1)).toBe(categories.at(-1));
    expect(labels).not.toContain('2026-10-13');
  });
  it('reuses exact store scopes and specific notes while retaining different dates and filters',()=>{
    const refs=[
      {id:'S1',title:'前期报表',provider:'Partner BI',sections:[{title:'本次筛选',items:[{label:'统计日期',value:'2026-09-24 至 2026-09-30'},{label:'查询范围',value:'2 家店铺'},{label:'有记录的店铺',value:'Unique Store'}]}],notes:['缺少上游完整性证明','订单不是利润']},
      {id:'S2',title:'本期报表',provider:'Partner BI',sections:[{title:'本次筛选',items:[{label:'统计日期',value:'2026-10-01 至 2026-10-07'},{label:'查询范围',value:'2 家店铺'},{label:'有记录的店铺',value:'Unique Store'},{label:'活动编号',value:'123456'}]}],notes:['订单不是利润']}
    ];
    const html=renderDocumentHtml(compiledDocumentSchema.parse({format:'pdf',document:{...draft().document,references:refs}}));
    expect(html.match(/Unique Store/g)).toHaveLength(1);
    expect(html).toContain('与 <a href="#source-S1">[S1]</a> 相同');
    expect(html).toContain('2026-09-24 至 2026-09-30');expect(html).toContain('2026-10-01 至 2026-10-07');
    expect(html).toContain('123456');expect(html).toContain('href="#source-S1-note-2"');
    expect(html).toContain('id="source-S1-note-2"');
    refs[1]!.provider='Other BI';
    expect(renderDocumentHtml(compiledDocumentSchema.parse({format:'pdf',document:{...draft().document,references:refs}})).match(/Unique Store/g)).toHaveLength(2);
  });
});

describe('document compiler reading actual saved evidence',()=>{
  async function fixture(rows:unknown[],run:(client:any,sources:EvidenceFileEntry[],dir:string)=>Promise<void>){
    const dir=await mkdtemp(join(tmpdir(),'document-compile-'));
    try{
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({dataset:'ads',data:{rows,coverage:{has_more:false}}});
      await writeFile(join(dir,'evidence','data.json'),raw);
      const client={usesWorker:()=>true,writeEvidence:vi.fn(async(_task:string,name:string,data:string)=>{
        await writeFile(join(dir,'evidence',name),data);return `evidence/${name}`;
      }),runPython:vi.fn(async(_task:string,code:string)=>{
        expect(code.length).toBeLessThan(20000);
        try{return {exitCode:0,timedOut:false,stderr:'',stdout:execFileSync('python',['-'],{cwd:dir,input:code,encoding:'utf8',stdio:['pipe','pipe','pipe']})};}
        catch(error){const e=error as any;return {exitCode:1,timedOut:false,stdout:String(e.stdout),stderr:String(e.stderr)};}
      })};
      await run(client,[source(raw)],dir);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  const sourceRef={evidenceId:'ads',where:{market:'UK'},limit:2};
  const payload=()=>documentRenderSchema.parse({format:'pdf',document:{title:'英国广告',blocks:[
    {id:'overview',type:'summary',text:'花费 {{fact:spend}}'},
    {id:'trend',type:'chart',kind:'line',category_field:'name',series:[{field:'spend',label:'花费'}],source:sourceRef},
    {id:'advice',type:'actions',items:[{proposal:'建议观察 7 天'}]},
    {id:'details',type:'table',columns:[{field:'name',label:'对象'},{field:'spend',label:'花费'}],source:sourceRef}
  ]},fact_bindings:[{id:'spend',evidenceId:'ads',where:{name:'A'},field:'spend',decimals:2}]});
  it('preserves block order, exact rows, null/zero, selection scope and bound scalar facts',async()=>{
    await fixture([{market:'UK',name:'A',spend:0},{market:'DE',name:'X',spend:99},{market:'UK',name:'B',spend:null},{market:'UK',name:'C',spend:5}],async(client,sources)=>{
      const result=await compileDocument(client,'task',payload(),sources);
      expect(result.compiled.document.blocks.map(b=>b.id)).toEqual(['overview','trend','advice','details']);
      expect(result.compiled.document.blocks[0]).toMatchObject({text:'花费 0.00'});
      expect(result.compiled.document.blocks[1]).toMatchObject({categories:['A','B'],series:[{values:[0,null]}]});
      expect(result.compiled.document.blocks[3]).toMatchObject({rows:[['A',0],['B',null]],coverage:expect.stringContaining('匹配 3 条')});
      expect(result.tables[0]).toMatchObject({sourceSha256:sources[0]!.sha256,selectedRowValues:[['A',0],['B',null]],selection:{rowIndices:[0,2],matchedRows:3},query:{marketplace:'UK'}});
      expect(result.facts[0]).toMatchObject({value:0,evidenceId:'ads'});
      expect(result.compiled.document.blocks[0]).toMatchObject({sourceRefs:['S1']});
      expect(result.compiled.document.references?.[0]).toMatchObject({id:'S1'});
      const html=renderDocumentHtml(result.compiled);
      expect(html).toContain('href="#source-S1"');
      expect(html).toContain('英国');
      expect(html).not.toContain('marketplace=UK');
      expect(html).toContain('本次筛选');
      expect(html).toContain('source-row');
    });
  });
  it.each([
    [{market:'UK',name:'A',spend:'10'},'DOCUMENT_CHART_REQUIRES_NUMBER'],
    [{market:'UK',name:'A',spend:true},'DOCUMENT_CHART_REQUIRES_NUMBER'],
    [{market:'UK',name:'A'},'DOCUMENT_FIELD_UNAVAILABLE']
  ])('rejects invalid chart types or missing fields',async(row,code)=>{
    await fixture([row],async(client,sources)=>{
      const data=payload();delete data.fact_bindings;data.document.blocks=data.document.blocks.filter(b=>b.type==='chart');
      await expect(compileDocument(client,'task',data,sources)).rejects.toThrow(code);
    });
  });
  it('rejects tampered source bytes before rendering',async()=>{
    await fixture([{market:'UK',name:'A',spend:10}],async(client,sources,dir)=>{
      await writeFile(join(dir,'evidence','data.json'),'{"data":{"rows":[]}}');
      await expect(compileDocument(client,'task',payload(),sources)).rejects.toThrow('EVIDENCE_HASH_MISMATCH');
    });
  });
  it.each([
    ['2026-10-09','2026-10-08'],
    ['2026-10-08','2026-10-08']
  ])('rejects out-of-order or repeated ISO dates in evidence-backed line charts',async(first,second)=>{
    await fixture([{market:'UK',name:first,spend:3},{market:'UK',name:second,spend:5}],async(client,sources)=>{
      const data=payload();delete data.fact_bindings;data.document.blocks=data.document.blocks.filter(b=>b.type==='chart');
      await expect(compileDocument(client,'task',data,sources)).rejects.toThrow('DOCUMENT_CHART_DATE_ORDER');
      (data.document.blocks[0] as any).kind='bar';
      const result=await compileDocument(client,'task',data,sources);
      expect(result.compiled.document.blocks[0]).toMatchObject({categories:[first,second]});
    });
  });
  it('preserves chronological date/value alignment in a line chart',async()=>{
    await fixture([{market:'UK',name:'2026-10-08',spend:5},{market:'UK',name:'2026-10-09',spend:3}],async(client,sources)=>{
      const data=payload();delete data.fact_bindings;data.document.blocks=data.document.blocks.filter(b=>b.type==='chart');
      const result=await compileDocument(client,'task',data,sources);
      expect(result.compiled.document.blocks[0]).toMatchObject({categories:['2026-10-08','2026-10-09'],series:[{values:[5,3]}]});
    });
  });
  it('rejects an empty chart and excludes report files as data sources',async()=>{
    await fixture([{market:'UK',name:'A',spend:10}],async(client,sources)=>{
      const data=payload();delete data.fact_bindings;data.document.blocks=data.document.blocks.filter(b=>b.type==='chart');
      (data.document.blocks[0] as any).source.where={market:'IT'};
      await expect(compileDocument(client,'task',data,sources)).rejects.toThrow('DOCUMENT_CHART_EMPTY');
      await expect(compileDocument(client,'task',payload(),[{...sources[0]!,kind:'report'}])).rejects.toThrow('FACT_SOURCE_UNAVAILABLE');
    });
  });
  it('matches selectors by type and preserves offset order without aggregating',async()=>{
    await fixture([{market:true,name:'A',spend:3},{market:1,name:'B',spend:4},{market:1,name:'C',spend:5}],async(client,sources)=>{
      const data=payload();delete data.fact_bindings;data.document.blocks=data.document.blocks.filter(b=>b.type==='table');
      (data.document.blocks[0] as any).source={evidenceId:'ads',rows_path:'data.rows',where:{market:1},offset:1,limit:1};
      const result=await compileDocument(client,'task',data,sources);
      expect(result.compiled.document.blocks[0]).toMatchObject({rows:[['C',5]]});
      expect(result.tables[0]).toMatchObject({selection:{rowIndices:[2],matchedRows:2}});
    });
  });
});
