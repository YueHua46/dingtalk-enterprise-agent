// Actual PostgreSQL regression for external shortcut targets. No DWS/model.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeExport} from '../dist/knowledge-export.js';
import {KnowledgeSheetExport} from '../dist/knowledge-sheet-export.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const user={corpId:'entry-fixture-'+randomUUID(),userId:'fixture'},entry='entry-'+randomUUID(),target='external-'+randomUUID(),hash=fingerprint('fixture');
const checks=[];let calls=0;
try{
 await new KnowledgeStore(pool,'fixture').discover(user,{nodeId:entry,workspaceId:'fixture',parentId:null,title:'fixture',path:'fixture',extension:'dlink',sourceUrl:'',metadata:{},metadataHash:hash},randomUUID());
 assert.equal((await pool.query('SELECT 1 FROM knowledge_resources WHERE corp_id=$1 AND node_id=$2',[user.corpId,target])).rowCount,0);
 const pdf=new KnowledgeExport(pool,'.',1024,async()=>{});
 await assert.rejects(pdf.download(user,target,hash,'unused',async()=>{calls++;throw Object.assign(new Error('fixture_query_failure'),{dwsJobId:'pdf_fixture'});},async()=>assert.fail(),async()=>{},entry),/fixture_query_failure/);
 const row=(await pool.query('SELECT node_id,entry_node_id,job_id FROM knowledge_exports WHERE corp_id=$1',[user.corpId])).rows[0];
 assert.deepEqual(row,{node_id:target,entry_node_id:entry,job_id:'pdf_fixture'});checks.push('external_pdf_target_keeps_source_job_and_indexed_entry');
 const sheet=new KnowledgeSheetExport(pool);
 const protocol={submit:async()=>{calls++;return {jobId:'sheet_fixture'};},query:async()=>{throw new Error('fixture_query_failure');},download:async()=>assert.fail()};
 await assert.rejects(sheet.downloadJob(user,target,hash,protocol,async()=>{},async()=>{},entry),/fixture_query_failure/);
 const s=(await pool.query('SELECT node_id,entry_node_id,job_id FROM knowledge_sheet_exports WHERE corp_id=$1',[user.corpId])).rows[0];
 assert.deepEqual(s,{node_id:target,entry_node_id:entry,job_id:'sheet_fixture'});checks.push('external_sheet_target_persists_job_before_failed_query');
 await assert.rejects(sheet.downloadJob({...user,userId:'other'},target,hash,protocol,async()=>{},async()=>{},entry),e=>e.code==='23503');assert.equal(calls,2);checks.push('employee_entry_foreign_key_blocks_cross_employee_before_submit');
 await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1',[user.corpId]);
 assert.equal((await pool.query('SELECT 1 FROM knowledge_exports WHERE corp_id=$1',[user.corpId])).rowCount,0);
 assert.equal((await pool.query('SELECT 1 FROM knowledge_sheet_exports WHERE corp_id=$1',[user.corpId])).rowCount,0);checks.push('entry_deletion_cascades_source_journals');
 const report={at:new Date().toISOString(),kind:'actual_pg_fixture',checks,passed:checks.length,dwsCalls:0,modelCalls:0};await writeFile('output/knowledge-diagnostics/export-entry-fixtures.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1',[user.corpId]);await pool.end();}
