// Read-only preflight. No task state changes or queue operations.
import {execFileSync} from 'node:child_process';
import {assertTaskRecoverySafe} from '../dist/task-recovery.js';
const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new Error('task UUID required');
const query = sql => JSON.parse(execFileSync('docker',['exec','dingtalk-enterprise-agent-postgres-1','psql','-U','agent','-d','agent','-At','-c',sql],{encoding:'utf8'}));
const row = query(`SELECT row_to_json(t) FROM tasks t WHERE id='${id}'`);
const workflow = query(`SELECT state FROM task_workflows WHERE task_id='${id}'`);
const audits = query(`SELECT coalesce(json_agg(json_build_object('eventType',event_type,'payload',payload) ORDER BY created_at,id),'[]'::json) FROM audit_events WHERE task_id='${id}'`);
const protectedState = query(`SELECT to_json(EXISTS(SELECT 1 FROM approvals WHERE task_id='${id}') OR EXISTS(SELECT 1 FROM tool_invocations WHERE task_id='${id}') OR EXISTS(SELECT 1 FROM task_artifacts WHERE task_id='${id}'))`);
const task = {id:row.id,request:row.request_payload,status:row.status,createdAt:Date.parse(row.created_at),threadId:row.codex_thread_id,errorCode:row.error_code};
try {
  assertTaskRecoverySafe(task,{requestId:'read-only-preflight',user:task.request.user,surface:task.request.surface},workflow,audits,protectedState);
  console.log(JSON.stringify({safe:true,taskId:id,evidence:workflow.evidence.length,checkpoints:Object.keys(workflow.toolCheckpoints ?? {}).length,capabilities:[...new Set(workflow.evidence.map(e=>e.capabilityId))]}));
} catch(error) { console.log(JSON.stringify({safe:false,taskId:id,error:error.message})); process.exitCode=1; }
