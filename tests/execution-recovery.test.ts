import {describe, it, expect, vi} from 'vitest';
import {TaskOrchestrator} from '../src/task-orchestrator.js';
import {InMemoryRepository} from '../src/persistence.js';
import {loadConfig} from './test-config.js';
import {executionLane, takeExecutionBudget} from '../src/execution-budget.js';
import {describeEvidence} from '../src/evidence-manifest.js';
import {TaskWorkflow} from '../src/task-workflow.js';

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
      expect(workflow.state.reportDraft).toBeUndefined();
      expect(workflow.state.artifactFacts).toBeUndefined();
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
      expect(workflow.state.reportDraft).toEqual({id:secondId,payload:expectedDraft});
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
      expect(workflow.state.reportDraft).toEqual({id:secondId,payload:expectedDraft});
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
        rowsPath:'data.rows',selectedRows:1,sourceRows:1,selection:{offset:0,limit:1},
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
    expect(changed.contentItems[0].text).toContain('FACT_REFERENCE_UNKNOWN');
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
  it.each(['502 Bad Gateway', 'stream disconnected before completion'])('continues after %s without querying again and includes saved evidence in the recovery prompt',async(error)=>{
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
  it('stops after one repeated incomplete Responses stream behind the HTTP proxy',async()=>{
    let turns=0;
    const h=setup(async(_id:string,_p:string,_e:any,onTool:any)=>{
      if(++turns===1) await onTool(call('crossborderops','query',{dataset:'ads.metrics'}));
      throw new Error('stream disconnected before completion: stream closed before response.completed');
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
