// Exact historical evidence, no inference from missing job/revision fields.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {KnowledgeSheetExport} from '../dist/knowledge-sheet-export.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'},file='output/knowledge-full-ingestion/progress-interrupted-v5-model-outage-20261007.json';
const prior=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(prior.user,user);
const nodes=['QG53mjyd80ynBzl9HjN9dMrXW6zbX04v','qnYMoO1rWxbOqpjAibXBRkZwJ47Z3je9'];
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),client=await pool.connect(),key=fingerprint([user.corpId,user.userId]);let locked=false;const resources=[];
try{
 locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 for(const node of nodes){
  const entry=prior.resources[node];assert.equal(entry.extension,'axls');assert.equal(entry.text.status,'failed');assert.equal(entry.text.stage,'dws_export');assert.equal(entry.text.dwsCategory,'internal');assert.equal(String(entry.text.dwsCode),'5');
  await client.query(`INSERT INTO knowledge_sheet_exports(corp_id,user_id,node_id,state) VALUES($1,$2,$3,'failed') ON CONFLICT DO NOTHING`,[user.corpId,user.userId,node]);
  await assert.rejects(new KnowledgeSheetExport(pool).download(user,node,async()=>{throw new Error('unexpected_submission');},async()=>{}),/PENDING_RESOLUTION/);
  resources.push({node,status:'guard_passed',jobId:'unknown_not_invented'});
 }
 const report={evidenceFile:file,kind:'historical_real_export_failure_and_database_guard',resources,exportsSubmitted:0,dwsCalls:0,modelCalls:0,indexWrites:0};
 await writeFile('output/knowledge-diagnostics/sheet-export-legacy-guard.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();await pool.end();}
