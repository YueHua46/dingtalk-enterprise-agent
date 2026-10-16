import {describe,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {InMemoryRepository} from '../src/persistence.js';
import {assertTaskRecoverySafe,recoveryToolAllowed,taskRecoveryPrompt} from '../src/task-recovery.js';
import {registerTaskRecoveryRoute} from '../src/task-recovery-route.js';
import type {WorkflowState} from '../src/task-workflow.js';
import type {AgentRequest} from '../src/types.js';

const request:AgentRequest={requestId:'original',messageId:'original',user:{corpId:'corp',userId:'employee'},
  surface:{type:'group',id:'original-group'},text:'只读广告分析并提供报告',attachments:[],receivedAt:1};
const input={requestId:'explicit-retry-1',user:request.user,surface:request.surface};
async function fixture() {
  const repo=new InMemoryRepository();
  const surfaceId=await repo.ensureSurface(request.user,request.surface);
  const task=await repo.createTask(structuredClone(request),surfaceId);
  await repo.updateTask(task.id,'failed',{threadId:'saved-thread',errorCode:'502 MODEL_REQUEST_RETRY_EXHAUSTED: model_upstream_unavailable'});
  const workflow:WorkflowState={evidence:[{id:'e1',capabilityId:'analysis.python',source:'analysis',status:'success',observedAt:'2026-10-14'}],revision:2,
    evidenceFiles:[{file:'evidence/01.json',evidenceId:'e1',capabilityId:'analysis.python',sha256:'a',kind:'derived',rootKeys:[]} as any],
    excerpts:{e1:'previous calculation'},executionBudget:{used:{collection:39,computation:7},exhausted:[]},reviewRounds:1,
    toolCheckpoints:{saved:{capabilityId:'analysis.python',evidenceId:'e1',result:'previous calculation',completedAt:'2026-10-14'}},
    artifactReviews:{rejected:{status:'revise',reason:'incorrect denominator',issues:[{severity:'blocking',category:'fact',location:'share',problem:'86%',fix:'55.12%'}],evidenceKey:'e1'}}};
  await repo.saveWorkflow(task.id,workflow);
  for(const eventType of ['tool.call_started','tool.call_finished']) await repo.audit({requestId:'original',taskId:task.id,user:request.user,eventType,
    payload:{namespace:'analysis',tool:'python',capabilityId:'analysis.python',argumentHash:'hash'}});
  return {repo,task,workflow};
}

describe('explicit recovery safety and atomic preparation',()=>{
  it('allows a completed input-read registration and its checkpoint',async()=>{
    const {repo,task,workflow}=await fixture();
    workflow.evidence.push({id:'read',capabilityId:'artifact.read',source:'artifact',status:'success',observedAt:'2026-10-16'});
    workflow.toolCheckpoints!.read={capabilityId:'artifact.read',evidenceId:'read',result:'saved read',completedAt:'2026-10-16'};
    await repo.saveWorkflow(task.id,workflow);
    for(const eventType of ['tool.call_started','tool.call_finished'])await repo.audit({requestId:'original',taskId:task.id,user:request.user,eventType,
      payload:{namespace:'artifact',tool:'record_read',argumentHash:'input-read'}});
    await expect(repo.prepareTaskRecovery(task.id,input)).resolves.toBeDefined();
  });
  it('only one concurrent request queues the original task and preserves all evidence and review budgets',async()=>{
    const {repo,task,workflow}=await fixture();
    const outcomes=await Promise.allSettled([repo.prepareTaskRecovery(task.id,input),repo.prepareTaskRecovery(task.id,input)]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(task.status).toBe('queued');expect(task.threadId).toBe('saved-thread');expect(task.errorCode).toBeUndefined();
    expect(task.request).toEqual(request);
    const restored=await repo.getWorkflow(task.id);
    expect(restored).toEqual({...workflow,manualRecoveries:[expect.objectContaining({requestId:input.requestId,previousError:expect.stringContaining('MODEL_REQUEST_RETRY_EXHAUSTED')})]});
    expect((repo.audits as any[]).filter(e=>e.eventType==='task.recovery_requested')).toHaveLength(1);
    const prompt=taskRecoveryPrompt(restored!);
    for(const expected of ['evidence/index.json','incorrect denominator','55.12%','analysis.python','artifact.submit']) expect(prompt).toContain(expected);
  });
  it.each(['corp','user','surfaceType','surfaceId'])('rejects a different %s',async(field)=>{
    const {repo,task}=await fixture();const wrong=structuredClone(input);
    if(field==='corp')wrong.user.corpId='other';if(field==='user')wrong.user.userId='other';
    if(field==='surfaceType')wrong.surface.type='direct';if(field==='surfaceId')wrong.surface.id='other';
    await expect(repo.prepareTaskRecovery(task.id,wrong)).rejects.toThrow('TASK_RECOVERY_NOT_FOUND');
    expect(task.status).toBe('failed');
  });
  it.each(['not-model','write','completion','artifact','unknown-invocation','pending-approval','unfinished-tool','unknown-tool','codex-event'])('fails closed on %s',async(mode)=>{
    const {repo,task,workflow}=await fixture();
    if(mode==='not-model')task.errorCode='ordinary failure';
    if(mode==='write')workflow.evidence[0]!.capabilityId='agent.memory';
    if(mode==='completion')workflow.completion={status:'partial',answer:'done',factEvidence:{},missingFacts:[]};
    if(mode==='artifact')await repo.saveTaskArtifact(task.id,{name:'already.pdf',size:1,sha256:'a'});
    if(mode==='unknown-invocation')await repo.beginToolInvocation({idempotencyKey:'unknown',taskId:task.id,actionHash:'a',toolName:'write'});
    if(mode==='pending-approval')await repo.saveApproval({taskId:task.id,user:request.user,action:{name:'write',risk:'write',target:'other',parameters:{}},parameterHash:'a',expiresAt:Date.now()+10000},'method');
    if(mode==='unfinished-tool'||mode==='unknown-tool')await repo.audit({requestId:'original',taskId:task.id,user:request.user,eventType:'tool.call_started',
      payload:{namespace:'analysis',tool:mode==='unknown-tool'?'unknown':'python',capabilityId:mode==='unknown-tool'?'unknown':'analysis.python',argumentHash:'new'}});
    if(mode==='codex-event')await repo.audit({requestId:'original',taskId:task.id,user:request.user,eventType:'codex.tool_event',payload:{method:'command'}});
    await repo.saveWorkflow(task.id,workflow);
    await expect(repo.prepareTaskRecovery(task.id,input)).rejects.toThrow('TASK_RECOVERY_');
    expect(task.status).toBe('failed');expect((await repo.getWorkflow(task.id))?.manualRecoveries).toBeUndefined();
  });
  it('rejects a replayed explicit request even if the task subsequently fails again',async()=>{
    const {repo,task}=await fixture();await repo.prepareTaskRecovery(task.id,input);
    await repo.updateTask(task.id,'failed',{errorCode:'MODEL_REQUEST_RETRY_EXHAUSTED'});
    await expect(repo.prepareTaskRecovery(task.id,input)).rejects.toThrow('TASK_RECOVERY_DUPLICATE');
  });
  it('does not allow an unmatched finish to cancel an earlier unknown call',async()=>{
    const {task,workflow}=await fixture();
    expect(()=>assertTaskRecoverySafe(task,input,workflow,[{eventType:'tool.call_finished',payload:{namespace:'analysis',tool:'python',capabilityId:'analysis.python'}}],false)).toThrow('UNKNOWN_TOOL_OUTCOME');
  });
  it('limits each resumed model tool call to reads, report generation, and normal submission review',()=>{
    for(const [namespace,tool,capability,allowed] of [
      ['crossborderops','query','crossborderops.ads.metrics',true],['reference','read_guide','reference.read_guide',true],
      ['analysis','python','analysis.python',true],['artifact','render_document','artifact.render_document',true],
      ['artifact','submit','artifact.submit',true],['amazon','update_bid','amazon.update_bid',false],
      ['artifact','record_read',undefined,true],['artifact','input',undefined,false],
      ['dingtalk','send','dingtalk.send',false],['agent','memory','agent.memory',false],['unknown','write',undefined,false]
    ] as const) expect(recoveryToolAllowed(namespace,tool,capability)).toBe(allowed);
  });
});

describe('recovery route authentication and validation',()=>{
  it('always requires the internal token and an explicit valid identity and original surface',async()=>{
    const app=Fastify();const resume=vi.fn(async()=>{});registerTaskRecoveryRoute(app,'internal-secret',resume);
    const url='/internal/tasks/4d464fb6-8384-4983-936a-b9ce15110d7f/resume';
    expect((await app.inject({method:'POST',url,payload:input})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url,headers:{'x-internal-token':'wrong'},payload:input})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url,headers:{'x-internal-token':'internal-secret'},payload:{requestId:'x'}})).statusCode).toBe(400);
    expect(resume).not.toHaveBeenCalled();
    expect((await app.inject({method:'POST',url,headers:{'x-internal-token':'internal-secret'},payload:input})).statusCode).toBe(202);
    expect(resume).toHaveBeenCalledWith('4d464fb6-8384-4983-936a-b9ce15110d7f',input);
    await app.close();
  });
  it('disables recovery entirely without a configured token',async()=>{
    const app=Fastify();const resume=vi.fn(async()=>{});registerTaskRecoveryRoute(app,undefined,resume);
    expect((await app.inject({method:'POST',url:'/internal/tasks/4d464fb6-8384-4983-936a-b9ce15110d7f/resume',payload:input})).statusCode).toBe(401);
    expect(resume).not.toHaveBeenCalled();await app.close();
  });
});
