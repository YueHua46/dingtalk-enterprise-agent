import {describe, it, expect, vi} from 'vitest';
import {TaskOrchestrator, requiresCompiledAdvertisingReport} from '../src/task-orchestrator.js';
import {InMemoryRepository} from '../src/persistence.js';
import {loadConfig} from './test-config.js';
import {executionLane, takeExecutionBudget} from '../src/execution-budget.js';
import {describeEvidence} from '../src/evidence-manifest.js';
import {TaskWorkflow} from '../src/task-workflow.js';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const config = loadConfig({DINGTALK_ROBOT_CODE:'robot', TASK_WORKFLOW_MODE:'enforce'});
const call = (namespace:string, tool:string, args:any) => ({method:'item/tool/call',params:{namespace,tool,arguments:args}});
const report = {template:'amazon-advertising',report:{report_title:'报告',marketplace:'DE',analysis_period:'7天',store_name:'授权店铺',executive_summary:'结果',data_quality:{}}};
const request = {requestId:'recovery',messageId:'recovery',user:{corpId:'corp',userId:'employee'},surface:{type:'group' as const,id:'original-group'},text:'分析广告并生成报告',attachments:[],receivedAt:Date.now()};
function setup(turn:any, overrides: Record<string,string> = {}) {
  const files = new Map<string,string>();
  const repo = new InMemoryRepository();
  const codex = {startThread:vi.fn(async()=> 'thread'),interrupt:vi.fn(async()=>{}),usesWorker:()=>true,
    writeEvidence:vi.fn(async(_id:string,name:string,raw:string)=>{files.set(name,raw);return `evidence/${name}`;}),
    renderReport:vi.fn(async()=>({path:'output/report.pdf'})),turn:vi.fn(turn)};
  const orchestrator = new TaskOrchestrator({...config,...overrides} as any,repo,codex as any,{} as any,{async send(){}},undefined,undefined,undefined,async()=>{});
  const query=vi.spyOn((orchestrator as any).crossBorderOpsTool,'execute').mockResolvedValue({dataset:'ads.metrics',data:{rows:[{spend:10,clicks:5}],coverage:{returned:1,has_more:false}},scope:{},evidence:{}});
  vi.spyOn((orchestrator as any).evidenceReviewer,'review').mockResolvedValue({status:'pass',issues:[],reason:'ok'});
  return {files,repo,codex,orchestrator,query};
}
describe('execution reserves and recovery',()=>{
  const documentPayload = {format:'pdf',document:{title:'广告观察',blocks:[{id:'answer',type:'summary',text:'先核对当前目标与数据范围。'}]}};
  const pdfWorkflow = (extra:any = {}) => new TaskWorkflow({revision:0,evidence:[],contract:{goal:'广告分析',
    delivery:{format:'pdf',detail:'brief'},deliverables:[],requiredFacts:[],assumptions:[],openQuestions:[],completionCriteria:[]},...extra});

  it.each([undefined,'chat'])('does not render generic documents without explicit PDF delivery: %s',async(format)=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const render=vi.fn();Object.assign(h.codex,{renderDocument:render});
    const workflow=pdfWorkflow();
    if(format)workflow.state.contract!.delivery={format,detail:'brief'} as any;
    else delete workflow.state.contract!.delivery;
    try {
      const result=await (h.orchestrator as any).handleCodexRequest({id:'no-pdf',request},'thread',call('artifact','render_document',documentPayload),workflow,new Map());
      expect(result.success).toBe(false);
      expect(result.contentItems[0].text).toContain('PDF_DELIVERY_NOT_REQUESTED');
      expect(render).not.toHaveBeenCalled();
      expect(workflow.state.documentDraft).toBeUndefined();
    } finally {await h.orchestrator.stop();}
  });

  it('recovers a failed generic draft, rejects stale/no-change revisions and requires actual delivery',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const render=vi.fn().mockRejectedValueOnce(new Error('DOCUMENT_RENDER_BUSY')).mockResolvedValue({path:'output/current.pdf',source:'output/current.html',previews:[],pageCount:1});
    Object.assign(h.codex,{renderDocument:render,inspectOutput:async()=>({name:'current.pdf',size:20,sha256:'a'.repeat(64),reviewText:'实际正文'})});
    const workflow=pdfWorkflow(),task={id:'generic-retry',request};
    const invoke=(tool:string,args:any)=>(h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact',tool,args),workflow,new Map());
    const complete=()=> (h.orchestrator as any).submitCompletion(task,undefined,workflow,new Map(),{status:'answered',answer:'done',factEvidence:{},missingFacts:[]},true);
    try {
      const failed=await invoke('render_document',documentPayload);
      expect(failed.success).toBe(false);
      const id=workflow.state.documentDraft!.id;
      expect((await complete()).feedback).toContain('DOCUMENT_DRAFT_NOT_COMPILED');
      expect((h.orchestrator as any).evidenceReviewer.review).not.toHaveBeenCalled();
      expect((await invoke('revise_document',{draft_id:'f'.repeat(64),changes:[{path:'/document/title',value:'修订'}]})).contentItems[0].text).toContain('DOCUMENT_DRAFT_STALE');
      expect((await invoke('revise_document',{draft_id:id,changes:[{path:'/document/title',value:documentPayload.document.title}]})).success).toBe(true);
      expect(workflow.state.documentDraft).toMatchObject({id,compiled:true,artifactSha256:'a'.repeat(64)});
      expect((await invoke('revise_document',{draft_id:id,changes:[{path:'/document/title',value:documentPayload.document.title}]})).contentItems[0].text).toContain('DOCUMENT_REVISION_NO_CHANGE');
      expect(render).toHaveBeenCalledTimes(2);
      expect((await complete()).feedback).toContain('DOCUMENT_NOT_DELIVERED');
      expect((h.orchestrator as any).evidenceReviewer.review).not.toHaveBeenCalled();
    } finally {await h.orchestrator.stop();}
  });

  it('reviews actual PDF text and saved row provenance, then delivers only the latest compiled version',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const dir=await mkdtemp(join(tmpdir(),'document-delivery-'));
    let currentHash='a'.repeat(64);
    const render=vi.fn(async()=>({path:'output/current.pdf',source:'output/current.html',previews:['output/current.page-1.png'],pageCount:1}));
    const task={id:'generic-delivery',request:{...request,text:'请把英国站观察导出简短 PDF'}};
    const deliver=vi.spyOn(h.orchestrator as any,'submitGeneratedArtifact').mockImplementation(async()=>({name:'current.pdf',size:20,sha256:currentHash}));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({data:{rows:[{scope:'overall',spend:10},{scope:'other',spend:90}]}});
      await writeFile(join(dir,'evidence','metrics.json'),raw);
      const source={file:'metrics.json',evidenceId:'metrics',capabilityId:'analysis.table',arguments:'{}',kind:'calculation' as const,
        sha256:createHash('sha256').update(raw).digest('hex'),query:{marketplace:'UK'},...describeEvidence(raw)};
      Object.assign(h.codex,{renderDocument:render,
        inspectOutput:async()=>({name:'current.pdf',size:20,sha256:currentHash,reviewText:'PDF实际正文：花费10'}),
        writeEvidence:async(_id:string,name:string,content:string)=>{await writeFile(join(dir,'evidence',name),content);return `evidence/${name}`;},
        runPython:async(_id:string,code:string)=>({exitCode:0,timedOut:false,stderr:'',stdout:execFileSync('python',['-'],{cwd:dir,input:code,encoding:'utf8'})})});
      const workflow=pdfWorkflow({evidenceFiles:[source]});
      const invoke=(tool:string,args:any)=>(h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact',tool,args),workflow,new Map());
      const payload={...documentPayload,document:{...documentPayload.document,blocks:[
        {id:'answer',type:'summary',text:'花费 {{fact:spend}}'},
        {id:'rows',type:'table',columns:[{field:'spend',label:'花费'}],source:{evidenceId:'metrics',where:{scope:'overall'}}}
      ]},fact_bindings:[{id:'spend',evidenceId:'metrics',where:{scope:'overall'},field:'spend'}]};
      expect((await invoke('render_document',payload)).success).toBe(true);
      const first=structuredClone(workflow.state.documentDraft!);
      currentHash='b'.repeat(64);
      expect((await invoke('revise_document',{draft_id:first.id,changes:[{path:'/document/title',value:'英国站简报'}]})).success).toBe(true);
      expect(workflow.state.documentDraft!.id).not.toBe(first.id);
      currentHash='a'.repeat(64);
      const old=await invoke('submit',{path:'output/current.pdf'});
      expect(old.success).toBe(false);
      expect(old.contentItems[0].text).toContain('DOCUMENT_LATEST_ARTIFACT_REQUIRED');
      expect(deliver).not.toHaveBeenCalled();
      currentHash='b'.repeat(64);
      expect((await invoke('submit',{path:'output/current.pdf',final_answer:'英国站简报已发送，请查看附件。'})).success).toBe(true);
      const review=(h.orchestrator as any).evidenceReviewer.review;
      const input=review.mock.calls[0][0];
      expect(JSON.parse(input.completion.answer)).toMatchObject({actualPdfText:'PDF实际正文：花费10',artifactBody:{title:'英国站简报',blocks:[{id:'answer',text:'花费 10'},{id:'rows',rows:[[10]]}]}});
      expect(input.verifiedEvidenceTables).toEqual([expect.objectContaining({evidenceId:'metrics',sourceSha256:source.sha256,selectedRowValues:[[10]],query:{marketplace:'UK'}})]);
      expect(deliver).toHaveBeenCalledOnce();
      expect(deliver.mock.calls[0]![0]).toMatchObject({request:{user:{corpId:'corp',userId:'employee'},surface:{type:'group',id:'original-group'}}});
      expect(workflow.state.evidence).toContainEqual(expect.objectContaining({capabilityId:'artifact.submit',scope:`task:${task.id}/output:${currentHash}`,status:'success'}));
      const completion=await (h.orchestrator as any).submitCompletion(task,undefined,workflow,new Map(),{status:'answered',answer:'英国站简报已发送，请查看附件。',factEvidence:{},missingFacts:[]},true);
      expect(completion.accepted).toBe(true);
      expect(review).toHaveBeenCalledOnce();
    } finally {await h.orchestrator.stop();await rm(dir,{recursive:true,force:true});}
  });

  it('does not infer PDF delivery from an advertising report request', () => {
    const workflow = new TaskWorkflow({revision:0,evidence:[],contract:{goal:'广告分析',delivery:{format:'chat',detail:'brief'},deliverables:[],requiredFacts:[],assumptions:[],openQuestions:[],completionCriteria:[]}});
    expect(requiresCompiledAdvertisingReport({request:{text:'分析德国广告报告'}} as any, workflow)).toBe(false);
    workflow.state.contract!.delivery = {format:'pdf',detail:'brief'};
    expect(requiresCompiledAdvertisingReport({request:{text:'分析英国广告'}} as any, workflow)).toBe(true);
  });

  it('blocks PDF rendering when the explicit delivery contract is chat', async () => {
    const h = setup(async()=>({text:'done',threadId:'thread'}));
    const workflow = new TaskWorkflow({revision:0,contract:{goal:'广告分析',delivery:{format:'chat',detail:'brief'},deliverables:[],requiredFacts:[],assumptions:[],openQuestions:[],completionCriteria:[]},evidence:[]});
    try {
      const result = await (h.orchestrator as any).handleCodexRequest({id:'chat-delivery',request},'thread',call('artifact','render_report',report),workflow,new Map());
      expect(result.success).toBe(false);
      expect(result.contentItems[0].text).toContain('PDF_DELIVERY_NOT_REQUESTED');
      expect(h.codex.renderReport).not.toHaveBeenCalled();
    } finally { await h.orchestrator.stop(); }
  });
  it('retries an unchanged failed draft without reviewing it as completed',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    h.codex.renderReport.mockRejectedValueOnce(new Error('RENDER_TEMPORARILY_UNAVAILABLE'));
    Object.assign(h.codex,{inspectOutput:async()=>({name:'report.pdf',size:20,sha256:'a'.repeat(64),reviewText:'body'})});
    const workflow=new TaskWorkflow({revision:0,evidence:[]});
    const task={id:'retry-failed-report',request};
    const invoke=(tool:string,args:any)=>(h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact',tool,args),workflow,new Map());
    try {
      const failed=await invoke('render_report',report);
      expect(failed.success).toBe(false);
      expect(workflow.state.reportDraft?.compiled).not.toBe(true);
      const completion=await (h.orchestrator as any).submitCompletion(task,undefined,workflow,new Map(),
        {status:'answered',answer:'done',factEvidence:{},missingFacts:[]},true);
      expect(completion).toMatchObject({accepted:false,feedback:expect.stringContaining('REPORT_DRAFT_NOT_COMPILED')});
      expect((h.orchestrator as any).evidenceReviewer.review).not.toHaveBeenCalled();
      expect(workflow.state.reviewRounds).toBeUndefined();
      const retry=await invoke('revise_report',{draft_id:workflow.state.reportDraft!.id,
        changes:[{path:'/report/executive_summary',value:report.report.executive_summary}]});
      expect(retry.success).toBe(true);
      expect(workflow.state.reportDraft?.compiled).toBe(true);
      expect(h.codex.renderReport).toHaveBeenCalledTimes(2);
    } finally {await h.orchestrator.stop();}
  });
  it('requires a compiled advertising PDF before spending semantic review time',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const workflow=new TaskWorkflow({revision:0,contract:{goal:'广告分析',delivery:{format:'pdf',detail:'standard'},deliverables:[],requiredFacts:[],assumptions:[],openQuestions:[],completionCriteria:[]},evidence:[{id:'ads',capabilityId:'crossborderops.ads.metrics',status:'success',scope:'DE',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()} as any]});
    const task={id:'missing-ad-pdf',request:{...request,text:'分析德国广告并生成 PDF 报告'}};
    try {
      const completion=await (h.orchestrator as any).submitCompletion(task,undefined,workflow,new Map(),
        {status:'answered',answer:'广告分析已完成。',factEvidence:{},missingFacts:[]},true);
      expect(completion).toMatchObject({accepted:false,feedback:expect.stringContaining('REPORT_REQUIRED_BEFORE_REVIEW')});
      expect((h.orchestrator as any).evidenceReviewer.review).not.toHaveBeenCalled();
    } finally {await h.orchestrator.stop();}
  });
  it('compiles a large fact report through the actual bounded interpreter transport',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const dir=await mkdtemp(join(tmpdir(),'report-transport-'));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({data:{rows:[{scope:'overall',amount:1.005}]}});
      await writeFile(join(dir,'evidence','metrics.json'),raw);
      const source={file:'metrics.json',evidenceId:'metrics',capabilityId:'analysis.table',arguments:'{}',kind:'calculation' as const,
        sha256:createHash('sha256').update(raw).digest('hex'),query:{description:'来源元数据'.repeat(300)},...describeEvidence(raw)};
      const workflow=new TaskWorkflow({revision:0,evidence:[],evidenceFiles:[source]});
      Object.assign(h.codex,{
        writeEvidence:vi.fn(async(_id:string,name:string,content:string)=>{
          h.files.set(name,content);await writeFile(join(dir,'evidence',name),content);return `evidence/${name}`;
        }),
        runPython:vi.fn(async(_id:string,code:string)=>{
          expect(code.length).toBeLessThanOrEqual(20000);
          expect(Buffer.byteLength(JSON.stringify({code}))).toBeLessThanOrEqual(64*1024);
          return {exitCode:0,timedOut:false,stderr:'',stdout:execFileSync('python',['-'],{cwd:dir,input:code,encoding:'utf8',maxBuffer:512*1024})};
        }),
        inspectOutput:async()=>({name:'report.pdf',size:20,sha256:'a'.repeat(64),reviewText:'body'})});
      const bindings=Array.from({length:100},(_,i)=>({id:`amount_${i}`,evidenceId:'metrics',where:{scope:'overall'},field:'amount',decimals:2}));
      const rendered=await (h.orchestrator as any).handleCodexRequest({id:'large-fact-report',request},'thread',call('artifact','render_report',{
        ...report,fact_bindings:bindings,report:{...report.report,executive_summary:bindings.map(b=>`{{fact:${b.id}}}`).join('，')}
      }),workflow,new Map());
      expect(rendered.success).toBe(true);
      expect(h.codex.renderReport.mock.calls[0]![1].report.executive_summary).toBe(Array(100).fill('1.01').join('，'));
      expect([...h.files.keys()]).toEqual([expect.stringMatching(/^report-facts-[a-f0-9]{64}\.json$/)]);
      const facts=workflow.state.artifactFacts!['a'.repeat(64)]!.facts;
      expect(facts).toHaveLength(100);
      expect(facts.every(f=>JSON.stringify(f.query)===JSON.stringify(source.query))).toBe(true);
    } finally {await h.orchestrator.stop();await rm(dir,{recursive:true,force:true});}
  });
  it('rejects unbound numeric reports before resolution or rendering',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const resolve=vi.fn();
    Object.assign(h.codex,{runPython:resolve});
    const workflow=new TaskWorkflow({revision:0,evidence:[],evidenceFiles:[{file:'metrics.json',evidenceId:'metrics',
      capabilityId:'analysis.table',arguments:'{}',kind:'calculation',sha256:'b'.repeat(64),
      tables:[{path:'data.rows',rows:1,fields:{scope:['string'],ctr:['number']}}]}]});
    const invoke=(args:any)=>(h.orchestrator as any).handleCodexRequest({id:'unbound-report',request},'thread',
      call('artifact','render_report',args),workflow,new Map());
    try {
      const unbound=await invoke({...report,report:{...report.report,executive_summary:'整体CTR 0.58%'}});
      expect(unbound.success).toBe(false);
      expect(unbound.contentItems[0].text).toContain('REPORT_FACT_BINDINGS_REQUIRED');
      const transcribed=await invoke({...report,report:{...report.report,executive_summary:'整体CTR {{fact:ctr}}，点击5'},
        fact_bindings:[{id:'ctr',evidenceId:'metrics',where:{scope:'overall'},field:'ctr',suffix:'%'}]});
      expect(transcribed.success).toBe(false);
      expect(transcribed.contentItems[0].text).toContain('REPORT_LITERAL_FACT_REQUIRES_BINDING:report.executive_summary');
      expect(resolve).not.toHaveBeenCalled();
      expect(h.codex.renderReport).not.toHaveBeenCalled();
      expect(workflow.state.reportDraft?.payload.report.executive_summary).toContain('点击5');
      expect(transcribed.contentItems[0].text).toContain('draft_id=' + workflow.state.reportDraft!.id);
      expect((await h.repo.getWorkflow('unbound-report'))?.reportDraft).toEqual(workflow.state.reportDraft);
      expect(workflow.state.artifactFacts).toBeUndefined();
      Object.assign(h.codex,{inspectOutput:async()=>({name:'manual.pdf',size:20,sha256:'c'.repeat(64),reviewText:'手工报告'})});
      const manual=await (h.orchestrator as any).handleCodexRequest({id:'unbound-report',request},'thread',
        call('artifact','submit',{path:'manual.pdf',final_answer:'广告报告已发送，请查看附件。'}),workflow,new Map());
      expect(manual.success).toBe(false);
      expect(manual.contentItems[0].text).toContain('REPORT_COMPILED_ARTIFACT_REQUIRED');
      expect((h.orchestrator as any).evidenceReviewer.review).not.toHaveBeenCalled();
    } finally {await h.orchestrator.stop();}
  });
  it('revises only the selected paragraph while preserving bindings, tables and the previous draft',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const facts=[{id:'ctr',evidenceId:'metrics',sourceSha256:'b'.repeat(64),rowsPath:'data.rows',rowIndex:0,
      selector:{scope:'overall'},field:'ctr',value:0.58,display:'0.58%',rowDimensions:{scope:'overall'},lineage:{}}];
    Object.assign(h.codex,{
      runPython:vi.fn(async()=>({exitCode:0,timedOut:false,stdout:JSON.stringify(facts),stderr:''})),
      inspectOutput:async()=>({name:'report.pdf',size:20,sha256:String(h.codex.renderReport.mock.calls.length).repeat(64),reviewText:'body'})});
    const workflow=new TaskWorkflow({revision:0,evidence:[],evidenceFiles:[{file:'metrics.json',evidenceId:'metrics',
      capabilityId:'analysis.table',arguments:'{}',kind:'calculation',sha256:'b'.repeat(64),
      tables:[{path:'data.rows',rows:1,fields:{scope:['string'],ctr:['number']}}]}]});
    const task={id:'report-local-revision',request};
    const invoke=(tool:string,args:any)=>(h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact',tool,args),workflow,new Map());
    const payload={...report,report:{...report.report,executive_summary:'整体CTR {{fact:ctr}}',
      overall_metrics:[{metric:'CTR',value:'{{fact:ctr}}'}],
      sections:[{title:'诊断',paragraphs:['原诊断','保留结论'],columns:['指标','值'],rows:[['CTR','{{fact:ctr}}']]}]},
      fact_bindings:[{id:'ctr',evidenceId:'metrics',where:{scope:'overall'},field:'ctr',decimals:2,suffix:'%'}]};
    try {
      const rendered=await invoke('render_report',payload);
      expect(rendered.success).toBe(true);
      const firstId=JSON.parse(rendered.contentItems[0].text).draft_id;
      expect(firstId).toMatch(/^[a-f0-9]{64}$/);
      const previousDraft=workflow.state.reportDraft!;
      const originalDraft=structuredClone(previousDraft);
      const firstRendered=structuredClone(h.codex.renderReport.mock.calls[0]![1]);
      const firstManifest=structuredClone(workflow.state.artifactFacts!['1'.repeat(64)]);
      const revised=await invoke('revise_report',{draft_id:firstId,changes:[{path:'/report/sections/0/paragraphs/0',value:'修订诊断'}]});
      expect(revised.success).toBe(true);
      const secondId=JSON.parse(revised.contentItems[0].text).draft_id;
      expect(secondId).not.toBe(firstId);
      const expectedDraft=structuredClone(originalDraft.payload);
      expectedDraft.report.sections![0]!.paragraphs![0]='修订诊断';
      expect(workflow.state.reportDraft).toEqual({id:secondId,payload:expectedDraft,compiled:true});
      expect(previousDraft).toEqual(originalDraft);
      const expectedRendered=structuredClone(firstRendered);
      expectedRendered.report.sections[0].paragraphs[0]='修订诊断';
      expect(h.codex.renderReport.mock.calls[1]![1]).toEqual(expectedRendered);
      expect(workflow.state.artifactFacts!['1'.repeat(64)]).toEqual(firstManifest);
      expect(workflow.state.artifactFacts!['2'.repeat(64)]!.facts).toEqual(facts);
      expect((await h.repo.getWorkflow(task.id))?.reportDraft).toEqual(workflow.state.reportDraft);
      const stale=await invoke('revise_report',{draft_id:firstId,changes:[{path:'/report/sections/0/paragraphs/0',value:'过期修改'}]});
      expect(stale.success).toBe(false);
      expect(stale.contentItems[0].text).toContain('REPORT_DRAFT_STALE');
      const unchanged=await invoke('revise_report',{draft_id:secondId,changes:[{path:'/report/sections/0/paragraphs/0',value:'修订诊断'}]});
      expect(unchanged.success).toBe(false);
      expect(unchanged.contentItems[0].text).toContain('REPORT_REVISION_NO_CHANGE');
      expect(h.codex.renderReport).toHaveBeenCalledTimes(2);
      expect(workflow.state.reportDraft).toEqual({id:secondId,payload:expectedDraft,compiled:true});
    } finally {await h.orchestrator.stop();}
  });
  it('reviews trusted appendix provenance and one canonical action without repeating rendered tables',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const sourceHash='b'.repeat(64), artifactHash='a'.repeat(64);
    const facts=[{id:'ctr',evidenceId:'metrics',sourceSha256:sourceHash,rowsPath:'data.rows',rowIndex:0,
      selector:{scope:'overall'},field:'ctr',value:0.58,display:'0.58%',rowDimensions:{scope:'overall'},lineage:{}}];
    const appendix={title:'原始指标附表',paragraphs:['完整附表说明'],columns:['范围','CTR'],rows:[['APPENDIX_ONLY_SENTINEL',0.58]]};
    Object.assign(h.codex,{
      runPython:vi.fn(async(_id:string,code:string)=>({exitCode:0,timedOut:false,
        stdout:JSON.stringify(code.includes('cfg=json.loads')?facts:[appendix]),stderr:''})),
      inspectOutput:async()=>({name:'report.pdf',size:20,sha256:artifactHash,reviewText:'APPENDIX_ONLY_SENTINEL duplicated renderer body'})});
    const deliver=vi.spyOn(h.orchestrator as any,'submitGeneratedArtifact').mockResolvedValue({name:'report.pdf',size:20,sha256:artifactHash});
    const source={file:'metrics.json',evidenceId:'metrics',capabilityId:'analysis.table',arguments:'{}',kind:'calculation' as const,
      sha256:sourceHash,tables:[{path:'data.rows',rows:1,fields:{scope:['string'],ctr:['number']}}]};
    const workflow=new TaskWorkflow({revision:0,evidence:[],evidenceFiles:[source,
      {...source,file:'unhashed.json',evidenceId:'unhashed',sha256:undefined},
      {...source,file:'report.json',evidenceId:'report-only',kind:'report'}]});
    const task={id:'report-canonical-review',request};
    const invoke=(tool:string,args:any)=>(h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact',tool,args),workflow,new Map());
    const action={id:'ctr_test',priority:'P1',object:'整体 {{fact:ctr}}',problem:'效率需进一步观察',evidence:'CTR {{fact:ctr}}',
      proposal:'建议测试增加10%',conditions:'实施前确认配置',observation:'7天复查',acceptance:'增量收益满足目标',
      stop_loss:'建议花费超过80美元且无订单时触发',rollback:'恢复原配置',confirmation:'修改须确认'};
    const payload={...report,report:{...report.report,executive_summary:'整体CTR {{fact:ctr}}',action_plan:[action],
      sections:[{title:'诊断',paragraphs:['当前窗口需要继续观察']}]},
      fact_bindings:[{id:'ctr',evidenceId:'metrics',where:{scope:'overall'},field:'ctr',decimals:2,suffix:'%'}],
      evidence_tables:[{title:appendix.title,evidenceId:'metrics',columns:[{field:'scope',label:'范围'},{field:'ctr',label:'CTR'}],limit:1}]};
    try {
      for(const evidenceId of ['unhashed','report-only']) {
        const rejected=await invoke('render_report',{...payload,evidence_tables:[{...payload.evidence_tables[0],evidenceId}]});
        expect(rejected.success).toBe(false);
        expect(rejected.contentItems[0].text).toContain('REPORT_EVIDENCE_TABLE_INVALID');
      }
      expect(h.codex.renderReport).not.toHaveBeenCalled();
      expect((await invoke('render_report',payload)).success).toBe(true);
      const rendered=h.codex.renderReport.mock.calls[0]![1] as any;
      expect(rendered.report.sections).toEqual([...payload.report.sections,appendix]);
      expect(rendered.report.action_plan).toBeUndefined();
      for(const table of ['budget_bid','execution_plan','review_plan','risks']) expect(rendered.report[table]).toHaveLength(1);
      expect(workflow.state.reportDraft!.payload.evidence_tables![0]!.evidenceId).toBe('metrics');
      expect((await invoke('submit',{path:'report.pdf',final_answer:'广告报告已发送，请查看附件。'})).success).toBe(true);
      const reviewInput=(h.orchestrator as any).evidenceReviewer.review.mock.calls[0][0];
      expect(reviewInput.verifiedEvidenceTables).toEqual([expect.objectContaining({evidenceId:'metrics',sourceSha256:sourceHash,
        rowsPath:'data.rows',selectedRows:1,sourceRows:1,selectedRowValues:appendix.rows,selection:{offset:0,limit:1},
        valuesSha256:expect.stringMatching(/^[a-f0-9]{64}$/),verification:'host_read_exact_saved_rows_without_transcription'})]);
      expect(reviewInput.verifiedFacts).toEqual({artifactSha256:artifactHash,facts});
      const completion=JSON.parse(reviewInput.completion.answer);
      expect(completion.artifactBody.action_plan).toEqual([{...action,object:'整体 0.58%',evidence:'CTR 0.58%'}]);
      expect(completion.artifactBody.sections).toEqual(payload.report.sections);
      expect(reviewInput.completion.answer).not.toContain('APPENDIX_ONLY_SENTINEL');
      expect(reviewInput.completion.answer.split(action.proposal)).toHaveLength(2);
      expect(reviewInput.completion.answer.split(action.stop_loss)).toHaveLength(2);
      for(const table of ['budget_bid','execution_plan','review_plan','risks']) expect(completion.artifactBody[table]).toBeUndefined();
      expect(deliver).toHaveBeenCalledOnce();
    } finally {await h.orchestrator.stop();}
  });
  it('resolves report and summary from the same facts and rejects references after PDF bytes change',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const oldHash='a'.repeat(64);
    let currentHash=oldHash;
    const facts=[{id:'ctr',evidenceId:'metrics',sourceSha256:'b'.repeat(64),rowsPath:'data.rows',rowIndex:0,
      selector:{scope:'overall'},field:'ctr',value:0.58,display:'0.58%',rowDimensions:{scope:'overall'},lineage:{}}];
    Object.assign(h.codex,{
      runPython:vi.fn(async()=>({exitCode:0,timedOut:false,stdout:JSON.stringify(facts),stderr:''})),
      inspectOutput:async()=>({name:'report.pdf',size:20,sha256:currentHash,reviewText:'整体CTR 0.58%'})});
    const deliver=vi.spyOn(h.orchestrator as any,'submitGeneratedArtifact').mockResolvedValue({name:'report.pdf',size:20,sha256:oldHash});
    const workflow=new TaskWorkflow({revision:0,evidence:[],evidenceFiles:[{file:'metrics.json',evidenceId:'metrics',
      capabilityId:'analysis.table',arguments:'{}',kind:'calculation',sha256:'b'.repeat(64),tables:[{path:'data.rows',rows:1,fields:{scope:['string'],ctr:['number']}}]}]});
    const task={id:'fact-pdf-binding',request};
    const invoke=(tool:string,args:any)=>(h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact',tool,args),workflow,new Map());
    const rendered=await invoke('render_report',{...report,report:{...report.report,executive_summary:'整体CTR {{fact:ctr}}'},
      fact_bindings:[{id:'ctr',evidenceId:'metrics',where:{scope:'overall'},field:'ctr',decimals:2,suffix:'%'}]});
    expect(rendered.success).toBe(true);
    expect(h.codex.renderReport.mock.calls[0]?.[1]).toMatchObject({report:{executive_summary:'整体CTR 0.58%'}});
    expect(workflow.state.artifactFacts?.[oldHash]?.facts).toEqual(facts);
    expect((await invoke('submit',{path:'report.pdf',final_answer:'整体CTR {{fact:ctr}}，详见报告。'})).success).toBe(true);
    const review=(h.orchestrator as any).evidenceReviewer.review;
    expect(review.mock.calls[0][0]).toMatchObject({verifiedFacts:{artifactSha256:oldHash,facts}});
    expect(review.mock.calls[0][0].completion.answer).toContain('整体CTR 0.58%');
    currentHash='c'.repeat(64);
    const changed=await invoke('submit',{path:'report.pdf',final_answer:'整体CTR {{fact:ctr}}，详见报告。'});
    expect(changed.success).toBe(false);
    expect(changed.contentItems[0].text).toContain('REPORT_COMPILED_ARTIFACT_REQUIRED');
    expect(deliver).toHaveBeenCalledOnce();
    await h.orchestrator.stop();
  });
  it('preserves an accepted partial result instead of retrying unresolved artifacts at finalization',async()=>{
    const h=setup(async(_id:string,_p:string,_e:any,onTool:any)=>{
      await onTool(call('agent','workflow',{operation:'complete',completion:{status:'partial',answer:'分析已保存，文件投递结果未知，未重发。',factEvidence:{},missingFacts:[]}}));
      return {text:'分析已保存，文件投递结果未知，未重发。',threadId:'thread'};
    });
    const deliver=vi.spyOn(h.orchestrator as any,'deliverArtifacts').mockRejectedValue(new Error('FILE_DELIVERY_OUTCOME_UNKNOWN'));
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('completed'));
    expect((await h.repo.getWorkflow(task!.id))?.completion?.status).toBe('partial');
    expect(deliver).not.toHaveBeenCalled();
    await h.orchestrator.stop();
  });
  it.each(['same','changed-answer','new-evidence','delivery-failed','review-rejected'])('joint artifact review is reused only for the exact delivered answer: %s',async(mode)=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const review=(h.orchestrator as any).evidenceReviewer.review;
    if(mode==='review-rejected') review.mockResolvedValue({status:'revise',issues:[{severity:'blocking',category:'fact',location:'summary',problem:'wrong',fix:'correct'}],reason:'wrong'});
    Object.assign(h.codex,{inspectOutput:async()=>({name:'report.pdf',size:20,sha256:'a'.repeat(64),reviewText:'Actual file body'})});
    const delivery=vi.spyOn(h.orchestrator as any,'submitGeneratedArtifact').mockImplementation(async()=>{
      if(mode==='delivery-failed') throw new Error('FILE_DELIVERY_OUTCOME_UNKNOWN');
      return {name:'report.pdf',size:20,sha256:'a'.repeat(64)};
    });
    const workflow=new TaskWorkflow({evidence:[],revision:0});
    const task={id:'joint-review',request};
    const excerpts=new Map();
    const result=await (h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact','submit',{path:'output/report.pdf',final_answer:'已发送。花费 10 元。'}),workflow,excerpts);
    expect(review.mock.calls.length,JSON.stringify(result)).toBeGreaterThan(0);
    expect(review.mock.calls[0][0].completion.answer).toContain('Actual file body');
    expect(review.mock.calls[0][0].completion.answer).toContain('花费 10 元');
    if(['delivery-failed','review-rejected'].includes(mode)) {
      expect(result.success).toBe(false);
      expect(workflow.state.reviewedDeliveryAnswer).toBeUndefined();
      if(mode==='review-rejected') expect(delivery).not.toHaveBeenCalled();
    } else {
      expect(result.success).toBe(true);
      if(mode==='new-evidence')workflow.record('analysis.python',true);
      await (h.orchestrator as any).submitCompletion(task,undefined,workflow,excerpts,{status:'answered',answer:mode==='changed-answer'?'另一个结论':'已发送。花费 10 元。',factEvidence:{},missingFacts:[]},true);
      expect(review).toHaveBeenCalledTimes(mode==='same'?1:2);
    }
    await h.orchestrator.stop();
  });
  it('charges only uncached content reviews and reserves delivery until a file passes',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    let hash='a'.repeat(64);
    Object.assign(h.codex,{inspectOutput:async()=>({name:'report.pdf',size:20,sha256:hash,reviewText:'body'})});
    const delivery=vi.spyOn(h.orchestrator as any,'submitGeneratedArtifact').mockImplementation(async()=>({name:'report.pdf',size:20,sha256:hash}));
    const review=(h.orchestrator as any).evidenceReviewer.review;
    review.mockResolvedValueOnce({status:'revise',issues:[{severity:'blocking',category:'fact',location:'report',problem:'wrong',fix:'correct'}],reason:'wrong'})
      .mockResolvedValue({status:'pass',issues:[],reason:'ok'});
    const workflow=new TaskWorkflow({evidence:[],revision:0,executionBudget:{version:2,used:{rendering:12},exhausted:['rendering']}});
    const task={id:'phase-review',request};
    const submit=()=> (h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact','submit',{path:'report.pdf',final_answer:'报告已发送，详见附件。'}),workflow,new Map());
    expect((await submit()).success).toBe(false);
    expect((await submit()).success).toBe(false);
    expect(review).toHaveBeenCalledTimes(1);
    expect(delivery).not.toHaveBeenCalled();
    expect(workflow.state.executionBudget?.used).toEqual({rendering:12,review:1});
    hash='b'.repeat(64);
    expect((await submit()).success).toBe(true);
    expect(review).toHaveBeenCalledTimes(2);
    expect(delivery).toHaveBeenCalledOnce();
    expect(workflow.state.executionBudget?.used).toEqual({rendering:12,review:2});
    await h.orchestrator.stop();
  });
  it.each(['review','delivery'] as const)('blocks publication when the %s phase is exhausted without skipping review',async(lane)=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    Object.assign(h.codex,{inspectOutput:async()=>({name:'report.pdf',size:20,sha256:'a'.repeat(64),reviewText:'body'})});
    const publish=vi.fn(async()=>({delivered:true}));
    (h.orchestrator as any).sender.sendFile=publish;
    (h.orchestrator as any).dws.status=async()=>({profileKey:'corp:employee'});
    vi.spyOn(h.orchestrator as any,'stageArtifact').mockResolvedValue('report.pdf');
    Object.assign(h.codex,{downloadOutput:async()=>Buffer.from('content')});
    const workflow=new TaskWorkflow({evidence:[],revision:0,executionBudget:{version:2,used:{[lane]:12},exhausted:[lane]}});
    const result=await (h.orchestrator as any).handleCodexRequest({id:'exhausted-'+lane,request},'thread',call('artifact','submit',{path:'report.pdf'}),workflow,new Map());
    expect(result.success).toBe(false);
    expect(result.contentItems[0].text).toContain('EXECUTION_LANE_EXHAUSTED');
    expect(publish).not.toHaveBeenCalled();
    expect((h.orchestrator as any).evidenceReviewer.review).toHaveBeenCalledTimes(lane==='review'?0:1);
    await h.orchestrator.stop();
  });
  it('reuses an exact passing review after review exhaustion and does not recharge an already delivered file',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    vi.spyOn(h.orchestrator as any,'enforcing').mockReturnValue(true);
    const hash='a'.repeat(64);
    Object.assign(h.codex,{inspectOutput:async()=>({name:'report.pdf',size:20,sha256:hash,reviewText:'body'})});
    vi.spyOn(h.orchestrator as any,'submitGeneratedArtifact').mockResolvedValue({name:'report.pdf',size:20,sha256:hash});
    const workflow=new TaskWorkflow({evidence:[],revision:0,executionBudget:{version:2,used:{review:11},exhausted:[]}});
    const task={id:'cache-after-budget',request};
    const submit=()=> (h.orchestrator as any).handleCodexRequest(task,'thread',call('artifact','submit',{path:'report.pdf',final_answer:'报告已发送，详见附件。'}),workflow,new Map());
    expect((await submit()).success).toBe(true);
    expect(workflow.state.executionBudget?.used.review).toBe(12);
    vi.spyOn(h.repo,'getToolInvocation').mockResolvedValue({idempotencyKey:'existing',taskId:task.id,actionHash:hash,status:'completed'});
    expect((await submit()).success).toBe(true);
    expect((h.orchestrator as any).evidenceReviewer.review).toHaveBeenCalledOnce();
    expect(workflow.state.executionBudget?.used.delivery).toBeUndefined();
    await h.orchestrator.stop();
  });
  it.each(['finalization','listing'] as const)('enforces delivery budget on the shared %s path',async(path)=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const task={id:'delivery-budget-'+path,request};
    const file={name:'report.txt',size:10,sha256:'a'.repeat(64)};
    await h.repo.saveWorkflow(task.id,{evidence:[],revision:0,executionBudget:{version:2,used:{delivery:12},exhausted:['delivery']}});
    await h.repo.saveTaskArtifact(task.id,file);
    Object.assign(h.codex,{inspectOutput:async()=>file,downloadOutput:async()=>Buffer.from('1234567890')});
    const send=vi.fn(async()=>({delivered:true}));
    (h.orchestrator as any).sender.sendFile=send;
    (h.orchestrator as any).dws.status=async()=>({profileKey:'corp:employee'});
    vi.spyOn(h.orchestrator as any,'stageArtifact').mockResolvedValue('task-local/report.txt');
    const dispatch=()=>path==='finalization'
      ? (h.orchestrator as any).deliverArtifacts(task,'thread')
      : (h.orchestrator as any).submitGeneratedArtifact(task,'thread','report.txt');
    await expect(dispatch()).rejects.toThrow('EXECUTION_LANE_EXHAUSTED');
    expect(send).not.toHaveBeenCalled();
    await h.orchestrator.stop();
  });
  it('does not charge delivery when staging fails before dispatch',async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const task={id:'failed-stage-budget',request};
    await h.repo.saveTaskArtifact(task.id,{name:'report.txt',size:10,sha256:'a'.repeat(64)});
    (h.orchestrator as any).sender.sendFile=vi.fn();
    vi.spyOn(h.orchestrator as any,'stageArtifact').mockRejectedValue(new Error('OUTPUT_HASH_MISMATCH'));
    await expect((h.orchestrator as any).deliverArtifacts(task,'thread')).rejects.toThrow('OUTPUT_HASH_MISMATCH');
    expect((await h.repo.getWorkflow(task.id))?.executionBudget?.used.delivery).toBeUndefined();
    await h.orchestrator.stop();
  });
  it('retains calculation and delivery reserves after collection exhaustion, including after reload',()=>{
    const state={used:{collection:40},exhausted:[]};
    expect(takeExecutionBudget(state,'collection').allowed).toBe(false);
    const restored=JSON.parse(JSON.stringify(state));
    expect(takeExecutionBudget(restored,'computation').allowed).toBe(true);
    expect(takeExecutionBudget(restored,executionLane('artifact','render_report')).allowed).toBe(true);
    expect(takeExecutionBudget({...restored,used:{control:24}},'control',true).allowed).toBe(true);
  });
  it('exposes all row fields and null types without pretending metadata describes only the first row',()=>{
    const info=describeEvidence(JSON.stringify({data:{rows:[{x:null},{x:2,later:'value'}],coverage:{has_more:true}}}));
    expect(info.tables?.[0]).toEqual({path:'data.rows',rows:2,fields:{x:['null','number'],later:['string']}});
    expect(info.context?.coverage).toEqual({has_more:true});
  });
  it('shares the persisted review budget across stages and refuses another review after exhaustion', async()=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    const workflow=new TaskWorkflow({revision:0,evidence:[]});
    const reviewer=vi.fn(async(input:any)=>{
      expect(input.deadlineAt).toBeLessThanOrEqual(Date.now()+360000);
      return {status:'pass',issues:[],reason:'supported'};
    });
    (h.orchestrator as any).evidenceReviewer.review=reviewer;
    const input={request:'read',completion:{status:'answered',answer:'done',factEvidence:{},missingFacts:[]},evidence:[],excerpts:{},computeAvailable:true,round:1,maxRounds:3};
    try {
      const first=await (h.orchestrator as any).reviewWithinTaskBudget({id:'review-budget'},workflow,input);
      expect(first.status).toBe('pass');
      expect(workflow.state.reviewBudget?.startedAt).toBeUndefined();
      workflow.state.reviewBudget={spentMs:360000};
      const restored=new TaskWorkflow(JSON.parse(JSON.stringify(workflow.state)));
      const second=await (h.orchestrator as any).reviewWithinTaskBudget({id:'review-budget'},restored,input);
      expect(second).toMatchObject({status:'unavailable',reason:expect.stringContaining('task_review_budget_exhausted')});
      expect(reviewer).toHaveBeenCalledOnce();
      restored.state.reviewBudget={spentMs:359000,startedAt:Date.now()-2000};
      const interrupted=await (h.orchestrator as any).reviewWithinTaskBudget({id:'review-budget'},restored,input);
      expect(interrupted.status).toBe('unavailable');
      expect(reviewer).toHaveBeenCalledOnce();
    } finally {await h.orchestrator.stop();}
  });
  it.each(['502 Bad Gateway', 'stream disconnected before completion', 'malformed_function_call'])('continues after %s without querying again and includes saved evidence in the recovery prompt',async(error)=>{
    let turns=0;
    const h=setup(async(_id:string,prompt:string,_events:any,onTool:any)=>{
      const result=await onTool(call('crossborderops','query',{dataset:'ads.metrics',params:{site:'DE'}}));
      expect(result.success).toBe(true);
      if (++turns===1) throw new Error(error);
      expect(prompt).toContain('从已保存检查点继续');
      expect(prompt).toContain('data.rows');
      expect(result.contentItems.map((i:any)=>i.text).join('')).toContain('evidence/01_');
      return {text:'花费10，点击5。',threadId:'thread'};
    });
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('completed'));
    expect(h.query).toHaveBeenCalledOnce();
    expect(h.codex.turn).toHaveBeenCalledTimes(2);
    expect((await h.repo.getWorkflow(task!.id))?.recoveryCount).toBe(1);
    await h.orchestrator.stop();
  });
  it('does not multiply transport attempts after the proxy has exhausted its retries',async()=>{
    const h=setup(async(_id:string,_p:string,_e:any,onTool:any)=>{
      await onTool(call('crossborderops','query',{dataset:'ads.metrics'}));
      throw new Error('502 MODEL_REQUEST_RETRY_EXHAUSTED');
    });
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('failed'));
    expect(h.codex.turn).toHaveBeenCalledOnce();
    expect(h.files.has('01_crossborderops.ads.metrics.json')).toBe(true);
    await h.orchestrator.stop();
  });
  it.each(['stream disconnected before completion: stream closed before response.completed','malformed_function_call'])('stops after one repeated protocol failure behind the HTTP proxy: %s',async(protocolError)=>{
    let turns=0;
    const h=setup(async(_id:string,_p:string,_e:any,onTool:any)=>{
      if(++turns===1) await onTool(call('crossborderops','query',{dataset:'ads.metrics'}));
      throw new Error(protocolError);
      return {text:'恢复后完成',threadId:'thread'};
    },{MODEL_TOOL_COMPAT_PROXY:'true'});
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('failed'));
    expect(h.codex.turn).toHaveBeenCalledTimes(2);
    expect(h.query).toHaveBeenCalledOnce();
    expect((await h.repo.getWorkflow(task!.id))?.recoveryCount).toBe(1);
    await h.orchestrator.stop();
  });
  it('recovers after one later incomplete stream even when the failed turn emitted no new tool call',async()=>{
    let turns=0;
    const h=setup(async(_id:string,prompt:string,_e:any,onTool:any)=>{
      if (++turns===1) await onTool(call('crossborderops','query',{dataset:'ads.metrics'}));
      if (turns===1) throw new Error('stream disconnected before completion: stream closed before response.completed');
      expect(prompt).toContain('从已保存检查点继续');
      return {text:'恢复完成',threadId:'thread'};
    },{MODEL_TOOL_COMPAT_PROXY:'true'});
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('completed'));
    expect(h.codex.turn).toHaveBeenCalledTimes(2);
    expect(h.query).toHaveBeenCalledOnce();
    await h.orchestrator.stop();
  });
  it('still invokes report rendering after collection has used its independent reserve',async()=>{
    let evidenceId='';
    const h=setup(async(_id:string,_p:string,_e:any,onTool:any)=>{
      for(let i=0;i<41;i++) {
        const r=await onTool(call('crossborderops','query',{dataset:'ads.metrics',params:{offset:i}}));
        expect(r.success).toBe(i<40);
        if(i===0) evidenceId=/证据 ID：([^；]+)/.exec(r.contentItems.at(-1).text)![1]!;
      }
      expect((await onTool(call('artifact','render_report',{...report,
        fact_bindings:[{id:'spend',evidenceId,field:'spend',where:{}}],
        report:{...report.report,executive_summary:'花费 {{fact:spend}}'}}))).success).toBe(true);
      return {text:'已完成计算，报告待发送。',threadId:'thread'};
    });
    Object.assign(h.codex,{runPython:async()=>({exitCode:0,timedOut:false,stdout:JSON.stringify([{id:'spend',evidenceId,field:'spend',display:'10'}]),stderr:''}),
      inspectOutput:async()=>({name:'report.pdf',size:20,sha256:'a'.repeat(64),reviewText:'花费10'})});
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('completed'));
    expect(h.query).toHaveBeenCalledTimes(40);
    expect(h.codex.renderReport).toHaveBeenCalledOnce();
    expect((await h.repo.getWorkflow(task!.id))?.executionBudget?.used.rendering).toBe(1);
    await h.orchestrator.stop();
  });
  it.each([false,true])('does not send an artifact twice when the previous outcome is unknown=%s',async(unknown)=>{
    const h=setup(async()=>({text:'done',threadId:'thread'}));
    Object.assign(h.codex,{inspectOutput:async()=>({name:'report.txt',size:10,sha256:'a'.repeat(64)}),downloadOutput:async()=>Buffer.from('1234567890')});
    const sendFile=vi.fn(async()=>{if(unknown)throw new Error('network timeout after dispatch');return {delivered:true};});
    (h.orchestrator as any).sender.sendFile=sendFile;
    (h.orchestrator as any).dws.status=async()=>({profileKey:'corp:employee'});
    vi.spyOn(h.orchestrator as any,'stageArtifact').mockResolvedValue('task-local/report.txt');
    const task={id:'delivery-recovery',request};
    const submit=()=>(h.orchestrator as any).submitGeneratedArtifact(task,'thread','output/report.txt');
    if(unknown){await expect(submit()).rejects.toThrow('timeout');await expect(submit()).rejects.toThrow('FILE_DELIVERY_OUTCOME_UNKNOWN');}
    else {await submit();await submit();}
    expect(sendFile).toHaveBeenCalledOnce();
    expect((await h.repo.getWorkflow(task.id))?.executionBudget?.used.delivery).toBe(1);
    expect(sendFile.mock.calls[0]?.slice(0,2)).toEqual([request.user,request.surface]);
    await h.orchestrator.stop();
  });
});
