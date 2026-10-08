// Import actual recorded provider refusals without guessing input hashes or
// treating them as DingTalk permission changes. No provider/DWS calls.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const evidenceFile='output/knowledge-full-ingestion/progress-completed-v3-20261007.json';
const evidence=JSON.parse(await readFile(evidenceFile,'utf8'));assert.deepEqual(evidence.user,user);
const nodes=Object.entries(evidence.resources).filter(([,entry])=>Object.values(entry).some(phase=>phase&&typeof phase==='object'&&phase.code==='KNOWLEDGE_EMBEDDING_HTTP_403')).map(([node])=>node);
assert.equal(nodes.length,3);
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(pool,evidence.embeddingModel),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]);let locked=false;
const results=[];
try{
 locked=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
 if(!locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 for(const node of nodes){
  assert(await store.resource(user,node));
  await pool.query(`INSERT INTO knowledge_embedding_rejections(corp_id,user_id,node_id,embedding_model,input_hash)
    VALUES($1,$2,$3,$4,NULL) ON CONFLICT DO NOTHING`,[user.corpId,user.userId,node,evidence.embeddingModel??null]);
  await assert.rejects(store.embedResource(user,node,['not submitted'],async()=>{throw new Error('unexpected_provider_call');}),/REJECTED_PENDING_RESOLUTION/);
  results.push({node,status:'guard_passed',inputHash:'unknown_not_invented'});
 }
 const report={evidenceFile,kind:'historical_real_refusal_import_and_actual_database_guard',resources:results,modelCalls:0,dwsCalls:0,indexWrites:0,sourceReadable:'not_retested'};
 await writeFile('output/knowledge-diagnostics/embedding-legacy-guard.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(locked)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);lock.release();await pool.end();}
