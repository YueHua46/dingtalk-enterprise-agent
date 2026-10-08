// Actual PostgreSQL outcome journal; submit/validation are fixtures, not DWS.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSheetExport} from '../dist/knowledge-sheet-export.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),user={corpId:'sheet-export-fixture-'+randomUUID(),userId:'fixture-only'},node='fixture-'+randomUUID();
const store=new KnowledgeStore(pool,'fixture'),journal=new KnowledgeSheetExport(pool),results=[];let submits=0;
const resource={nodeId:node,workspaceId:'fixture',parentId:null,title:'fixture',path:'fixture',extension:'axls',sourceUrl:'',metadata:{},metadataHash:fingerprint('fixture')};
const noSubmit=async()=>{throw new Error('unexpected_submission');},validate=async()=>{};
try{
 await store.discover(user,resource,randomUUID());
 await assert.rejects(journal.download(user,node,async()=>{submits++;throw Object.assign(new Error('fixture_export_failure'),{dwsJobId:'job_fixture_123'});},validate));
 await assert.rejects(new KnowledgeSheetExport(pool).download(user,node,noSubmit,validate),/PENDING_RESOLUTION/);
 assert.equal(submits,1);assert.equal((await pool.query('SELECT job_id FROM knowledge_sheet_exports WHERE corp_id=$1',[user.corpId])).rows[0].job_id,'job_fixture_123');results.push('failed_job_survives_restart_without_resubmission');
 await store.discover(user,{...resource,metadataHash:fingerprint('changed')},randomUUID());
 await assert.rejects(journal.download(user,node,noSubmit,validate),/PENDING_RESOLUTION/);results.push('source_changes_do_not_clear_unknown_failed_outcome');
 const other={...user,userId:'other-fixture'};await store.discover(other,resource,randomUUID());
 await journal.download(other,node,async()=>{submits++;},validate);results.push('different_employee_isolated');
 // A successful previous read is not reused as proof of current source.
 await journal.download(other,node,async()=>{submits++;},validate);assert.equal(submits,3);results.push('successful_read_is_not_a_stale_cache');
 let release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const first=journal.download(other,node,async()=>{entered();await waiting;},validate);await started;
 await assert.rejects(journal.download(other,node,noSubmit,validate),/EXPORT_BUSY/);release();await first;results.push('concurrent_submission_serialized');
 await assert.rejects(journal.download(other,node,async()=>{},async()=>{throw new Error('scan_failed');}),/scan_failed/);
 await assert.rejects(journal.download(other,node,noSubmit,validate),/PENDING_RESOLUTION/);results.push('validation_failure_not_marked_complete');
 const third={...user,userId:'crashed-fixture'};await store.discover(third,resource,randomUUID());
 await pool.query(`INSERT INTO knowledge_sheet_exports(corp_id,user_id,node_id,state) VALUES($1,$2,$3,'starting')`,[third.corpId,third.userId,node]);
 await assert.rejects(journal.download(third,node,noSubmit,validate),/PENDING_RESOLUTION/);results.push('interrupted_without_job_does_not_resubmit');
 const report={kind:'actual_postgresql_with_export_fixtures',passed:results,realDwsCalls:0,modelCalls:0};
 await writeFile('output/knowledge-diagnostics/sheet-export-guard-fixtures.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1',[user.corpId]);await pool.end();}
