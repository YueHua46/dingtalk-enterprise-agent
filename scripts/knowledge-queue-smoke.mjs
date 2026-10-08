// Actual PostgreSQL and Redis queues; source responses are fixtures, not DWS acceptance.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {loadConfig} from '../dist/config.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSync} from '../dist/knowledge-sync.js';
const user={corpId:'queue-fixture-'+randomUUID(),userId:'queue-test-only'};
const config=loadConfig({NODE_ENV:'test',DINGTALK_ROBOT_CODE:'queue-test-only',FILE_WORKER_MODE:'off',REDIS_URL:'redis://127.0.0.1:16379',
 KNOWLEDGE_TEST_USERS:user.corpId+':'+user.userId,KNOWLEDGE_SYNC_INTERVAL_MS:'900000'});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL);
const sync=new KnowledgeSync(config,store,{runCommand:async()=>({requestedType:'orgWikiSpace',autoPageComplete:true,spaces:[]})},
 {supported:()=>false},{});
const checks=[];
async function completed(expected){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  const {rows}=await pool.query("SELECT count(*)::int n FROM knowledge_sync_runs WHERE corp_id=$1 AND user_id=$2 AND status='complete'",[user.corpId,user.userId]);
  if(rows[0].n===expected)return;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('QUEUE_COMPLETION_TIMEOUT');
}
try{
 await store.enable(user);await sync.start();await completed(1);
 await Promise.all([sync.enqueue(user),sync.enqueue(user)]);
 await new Promise(resolve=>setTimeout(resolve,300));await completed(1);
 checks.push({name:'real_queue_scan_and_interval_dedup',status:'passed',kind:'postgres_redis_source_fixture'});
 await pool.query('UPDATE knowledge_users SET paused=true WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);
 await sync.enqueue(user);await completed(1);
 await sync.authorizationVerified(user);await completed(2);
 const row=await pool.query('SELECT paused FROM knowledge_users WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);assert.equal(row.rows[0].paused,false);
 checks.push({name:'real_queue_pause_and_verified_resume',status:'passed',kind:'postgres_redis_source_fixture_not_real_OAuth'});
}catch(e){checks.push({name:'queue_smoke',status:'failed',code:/^[A-Z_]+$/.test(e.message)?e.message:'QUEUE_CHECK_FAILED'});process.exitCode=1;}
finally{
 await sync.stop();await pool.query('DELETE FROM knowledge_sync_runs WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);
 await pool.query('DELETE FROM knowledge_users WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);await pool.end();
 await writeFile('output/knowledge-acceptance-2026-09-30/queue-results.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}
