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
    const h=setup(async(_id:string,_p:string,_e:any,onTool:any)=>{
      for(let i=0;i<41;i++) {
        const r=await onTool(call('crossborderops','query',{dataset:'ads.metrics',params:{offset:i}}));
        expect(r.success).toBe(i<40);
      }
      expect((await onTool(call('artifact','render_report',report))).success).toBe(true);
      return {text:'已完成计算，报告待发送。',threadId:'thread'};
    });
    const task=await h.orchestrator.accept(request);
    await vi.waitFor(async()=>expect((await h.repo.findTask(task!.id))?.status).toBe('completed'));
    expect(h.query).toHaveBeenCalledTimes(40);
    expect(h.codex.renderReport).toHaveBeenCalledOnce();
    expect((await h.repo.getWorkflow(task!.id))?.executionBudget?.used.delivery).toBe(1);
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
    expect(sendFile.mock.calls[0]?.slice(0,2)).toEqual([request.user,request.surface]);
    await h.orchestrator.stop();
  });
});
