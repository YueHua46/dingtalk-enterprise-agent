// Real PostgreSQL; provider responses are fixtures, never real export recovery.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {writeFile} from 'node:fs/promises';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSheetExport} from '../dist/knowledge-sheet-export.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const user={corpId:'sheet-job-fixture-'+randomUUID(),userId:'fixture'},node='fixture-'+randomUUID(),hash=fingerprint('source');
const store=new KnowledgeStore(pool,'fixture'),journal=new KnowledgeSheetExport(pool),checks=[];
const resource={nodeId:node,workspaceId:'fixture',parentId:null,title:'fixture',path:'fixture',extension:'axls',sourceUrl:'',metadata:{},metadataHash:hash};
const row=async()=> (await pool.query('SELECT * FROM knowledge_sheet_exports WHERE corp_id=$1',[user.corpId])).rows[0];
let submits=0,queries=0;
try{
 await store.discover(user,resource,randomUUID());
 const submit=async()=>{submits++;return {result:{jobId:'xlsx_fixture'}};};
 await assert.rejects(journal.downloadJob(user,node,hash,{submit,query:async job=>{
  queries++;assert.equal((await row()).job_id,job);throw Object.assign(new Error('fixture_query_transport'),{dwsReason:'request_failed',dwsRequestId:'req-fixture'});
 },download:async()=>assert.fail('unexpected download')},async()=>{},async()=>{}),/fixture_query_transport/);
 assert.equal(queries,1);assert.equal((await row()).stage,'query');assert.equal((await row()).diagnostic.requestId,'req-fixture');checks.push('persist_job_before_query_and_surface_first_error');
 const noSubmit=async()=>assert.fail('duplicate submit');let downloaded=false;
 await new KnowledgeSheetExport(pool).downloadJob(user,node,hash,{submit:noSubmit,query:async job=>{assert.equal(job,'xlsx_fixture');return {status:'SUCCESS',downloadUrl:'https://fixture.invalid/file'};},download:async()=>{downloaded=true;}},async()=>{},async()=>{});
 assert.equal(submits,1);assert.equal(downloaded,true);assert.equal((await row()).state,'complete');checks.push('restart_queries_original_job_without_submission');
 await pool.query("UPDATE knowledge_sheet_exports SET state='failed' WHERE corp_id=$1",[user.corpId]);
 await assert.rejects(journal.downloadJob(user,node,fingerprint('changed'),{submit:noSubmit,query:async()=>assert.fail('stale job query'),download:async()=>{}},async()=>{}),/PENDING_RESOLUTION/);checks.push('changed_source_does_not_activate_old_export');
 await assert.rejects(journal.downloadJob(user,node,hash,{submit:noSubmit,query:async()=>({status:'SUCCESS',downloadUrl:'https://fixture.invalid/file'}),download:async()=>{throw new Error('fixture_download');}},async()=>{}),/fixture_download/);
 assert.equal((await row()).job_id,'xlsx_fixture');assert.equal((await row()).stage,'download');checks.push('download_failure_keeps_original_job');
 await assert.rejects(journal.downloadJob(user,node,hash,{submit:noSubmit,query:async()=>({status:'SUCCESS',downloadUrl:'https://fixture.invalid/file'}),download:async()=>{}},async()=>{throw new Error('fixture_scan');}),/fixture_scan/);
 assert.equal((await row()).stage,'validate');assert.equal((await row()).job_id,'xlsx_fixture');checks.push('scan_failure_not_complete_and_keeps_job');
 let polls=0,waits=0;
 await assert.rejects(journal.downloadJob(user,node,hash,{submit:noSubmit,query:async()=>{polls++;return {status:'PROCESSING'};},download:async()=>{}},async()=>{},async()=>{waits++;}),/PROCESSING_TIMEOUT/);
 assert.equal(polls,30);assert.equal(waits,29);checks.push('only_processing_is_polled_with_finite_budget');
 await pool.query('UPDATE knowledge_sheet_exports SET job_id=NULL,source_hash=NULL WHERE corp_id=$1',[user.corpId]);
 await assert.rejects(journal.downloadJob(user,node,hash,{submit:noSubmit,query:async()=>assert.fail('guessed job'),download:async()=>{}},async()=>{}),/PENDING_RESOLUTION/);checks.push('legacy_unknown_does_not_submit_or_guess');
 const result={kind:'actual_postgres_protocol_fixtures',checks,passed:checks.length,realDwsCalls:0,modelCalls:0};
 await writeFile('output/knowledge-diagnostics/sheet-job-fixtures.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1',[user.corpId]);await pool.end();}
