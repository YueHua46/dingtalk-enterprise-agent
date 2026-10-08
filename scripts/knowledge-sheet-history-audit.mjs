// Offline correlation only. Log text/arguments/bodies never leave memory.
// --register imports unresolved outcomes, never guesses that a server job was
// created, never resets permissions or calls the provider/export endpoint.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {Pool} from 'pg';
import {fingerprint} from '../dist/knowledge-parse.js';
import {KnowledgeSheetExport} from '../dist/knowledge-sheet-export.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const evidenceFile='output/knowledge-full-ingestion/progress-interrupted-v5-model-outage-20261007.json',raw=await readFile(evidenceFile,'utf8'),prior=JSON.parse(raw);
assert.deepEqual(prior.user,user);
const start=Date.parse(prior.startedAt),end=Date.parse(prior.updatedAt);assert(Number.isFinite(start)&&Number.isFinite(end)&&end>=start);
const executions=new Map();const logFiles=[];
for(const name of ['dws.log','dws.log.2']){
 let content;try{content=await readFile(join(homedir(),'.dws/logs',name),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
 logFiles.push(name);
 for(const line of content.split(/\r?\n/)){
  let r;try{r=JSON.parse(line);}catch{continue;}
  const time=Date.parse(r.time);if(time<start||time>end||!Number.isFinite(time)||typeof r.execution_id!=='string')continue;
  const group=executions.get(r.execution_id)??[];group.push(r);executions.set(r.execution_id,group);
 }
}
const resources=[];
for(const [node,entry] of Object.entries(prior.resources)){
 if(entry.extension!=='axls'||!/^[A-Za-z0-9_-]{8,128}$/.test(node))continue;
 const phases=['text','images'].filter(k=>entry[k]?.status==='failed'&&entry[k]?.stage==='dws_export');if(!phases.length)continue;
 const counts={submitFailed:0,submitTransportUnknown:0,submitSucceeded:0};
 for(const rows of executions.values()){
  if(!rows.some(r=>typeof r.arguments_summary==='string'&&r.arguments_summary.includes(node)))continue;
  for(const r of rows){
   if(r.product!=='sheet'||r.tool!=='submit_export_job'||typeof r.success!=='boolean')continue;
   if(r.success)counts.submitSucceeded++;
   else{counts.submitFailed++;if(['tls_timeout','request_failed'].includes(r.error_reason))counts.submitTransportUnknown++;}
  }
 }
 // Successful transport/submission is not proof of completed download; a
 // transport failure is not proof of no server job. No unsupported binding.
 resources.push({node,phases,...counts,outcome:counts.submitTransportUnknown?'submit_transport_outcome_unknown':'export_workflow_failed_outcome_unknown',jobId:'not_invented'});
}
const report={checkedAt:new Date().toISOString(),user,evidenceFile,evidenceHash:fingerprint(raw),logFiles,resources,
 totals:{resources:resources.length,correlatedTransportUnknown:resources.filter(r=>r.submitTransportUnknown>0).length,withoutSubmitCorrelation:resources.filter(r=>!r.submitFailed&&!r.submitSucceeded).length},
 exportsSubmitted:0,dwsCalls:0,modelCalls:0,indexWrites:0,registered:0};
if(process.argv.includes('--register')){
 const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]);let locked=false;
 try{
  locked=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
  for(const r of resources){
   // starting represents an unresolved attempted workflow, not a claim that
   // the DingTalk server created a job. Missing correlation stays explicit.
   await pool.query(`INSERT INTO knowledge_sheet_exports(corp_id,user_id,node_id,state) VALUES($1,$2,$3,'starting') ON CONFLICT DO NOTHING`,[user.corpId,user.userId,r.node]);
   await assert.rejects(new KnowledgeSheetExport(pool).download(user,r.node,async()=>{throw new Error('unexpected_submission');},async()=>{}),/PENDING_RESOLUTION/);
   report.registered++;
  }
 }finally{if(locked)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);lock.release();await pool.end();}
}
await writeFile('output/knowledge-diagnostics/sheet-history-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({totals:report.totals,registered:report.registered,exportsSubmitted:0,dwsCalls:0,modelCalls:0,indexWrites:0}));
