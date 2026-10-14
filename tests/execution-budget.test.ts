import {describe,expect,it} from 'vitest';
import {InMemoryRepository} from '../src/persistence.js';
import {executionLane, takeExecutionBudget, migrateArtifactBudget, budgetFeedback, type ExecutionBudgetState, type ArtifactBudgetHistory} from '../src/execution-budget.js';

const history = (renders:number, submits:number): ArtifactBudgetHistory => ({deliveryAttempts:0,calls:
  [...Array(renders).fill('render_report'),...Array(submits).fill('submit')].flatMap((tool,i) =>
    ['tool.call_started','tool.call_finished'].map(eventType => ({eventType,payload:{namespace:'artifact',tool,argumentHash:String(i)}}))) });

describe('independent artifact phase budgets',()=>{
  it('reads only the selected task artifact history and counts unknown sends conservatively',async()=>{
    const repo=new InMemoryRepository();
    const user={corpId:'corp',userId:'employee'};
    for(const taskId of ['target','other']){
      for(const eventType of ['tool.call_started','tool.call_finished'])await repo.audit({requestId:'r',taskId,user,eventType,
        payload:{namespace:'artifact',tool:'submit',argumentHash:'hash'}});
      await repo.beginToolInvocation({idempotencyKey:taskId,taskId,actionHash:'sha',toolName:'artifact.send'});
      await repo.finishToolInvocation(taskId,'unknown');
    }
    await repo.beginToolInvocation({idempotencyKey:'business',taskId:'target',actionHash:'business',toolName:'amazon.write'});
    const h=await repo.getArtifactBudgetHistory('target');
    expect(h.calls).toHaveLength(2);
    expect(h.deliveryAttempts).toBe(1);
  });
  it('retains every legacy charge while separating reviewed revisions from actual dispatch',()=>{
    const state:ExecutionBudgetState={used:{collection:10,delivery:12},exhausted:['delivery']};
    expect(migrateArtifactBudget(state,history(7,5))).toBe(true);
    expect(state.used).toEqual({collection:10,rendering:7,review:5,delivery:0});
    expect(state.legacyArtifactBudget).toEqual({used:12,exhausted:true,renderingCalls:7,submissionCalls:5,deliveryAttempts:0});
    const restored:ExecutionBudgetState=JSON.parse(JSON.stringify(state));
    expect(migrateArtifactBudget(restored,history(0,0))).toBe(false);
    expect(restored).toEqual(state);
    expect(takeExecutionBudget(restored,'review').allowed).toBe(true);
    expect(takeExecutionBudget(restored,'delivery').allowed).toBe(true);
  });
  it.each(['missing-call','pending-call','orphan-finish','missing-history'])('blocks unreconciled historical usage: %s',mode=>{
    const state:ExecutionBudgetState={used:{delivery:12},exhausted:['delivery']};
    const h=history(7,5);
    if(mode==='missing-call')h.calls.splice(0,2);
    if(mode==='pending-call')h.calls.pop();
    if(mode==='orphan-finish')h.calls.shift();
    expect(migrateArtifactBudget(state,mode==='missing-history'?undefined:h)).toBe(false);
    expect(state.used).toEqual({delivery:12});
    expect(state.exhausted).toEqual(['delivery']);
    expect(state.migrationBlocked).toBe('EXECUTION_BUDGET_MIGRATION_UNVERIFIED');
    for(const lane of ['rendering','review','delivery'] as const)expect(takeExecutionBudget(state,lane).allowed).toBe(false);
    expect(takeExecutionBudget(state,'control',true).allowed).toBe(true);
  });
  it('preserves real dispatch attempts and the exhausted rendering reserve',()=>{
    const state:ExecutionBudgetState={used:{delivery:12},exhausted:['delivery']};
    const h=history(12,0);h.deliveryAttempts=2;
    migrateArtifactBudget(state,h);
    expect(takeExecutionBudget(state,'rendering').allowed).toBe(false);
    expect(state.used.delivery).toBe(2);
    expect(takeExecutionBudget(state,'review').allowed).toBe(true);
    expect(takeExecutionBudget(state,'delivery').allowed).toBe(true);
  });
  it('keeps all three phases finite and gives truthful exhausted-stage guidance',()=>{
    const state:ExecutionBudgetState={version:2,used:{rendering:12,review:12,delivery:12},exhausted:[]};
    expect(executionLane('artifact','render_report')).toBe('rendering');
    expect(executionLane('artifact','submit')).toBe('review');
    for(const lane of ['rendering','review','delivery'] as const)expect(takeExecutionBudget(state,lane).allowed).toBe(false);
    expect(budgetFeedback('review',false)).toContain('禁止继续更换文件');
    expect(budgetFeedback('delivery',false)).toContain('不要重新发送');
    expect(takeExecutionBudget(state,'control',true).allowed).toBe(true);
  });
});
