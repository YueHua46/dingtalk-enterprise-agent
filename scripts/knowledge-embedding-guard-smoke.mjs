// Actual PostgreSQL persistence/concurrency fixtures; provider replies are
// fixtures, never evidence of model recovery or live DingTalk authorization.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const user={corpId:'embedding-fixture-'+randomUUID(),userId:'fixture-only'},node='fixture-'+randomUUID(),results=[];
const store=new KnowledgeStore(pool,'fixture-model');let requests=0;
const resource={nodeId:node,workspaceId:'fixture',parentId:null,title:'fixture',path:'fixture',extension:'adoc',sourceUrl:'',metadata:{},metadataHash:fingerprint('fixture')};
const reject=async()=>{requests++;throw Object.assign(new Error('KNOWLEDGE_EMBEDDING_HTTP_403'),{providerCode:'DataInspectionFailed',providerRequestId:'fixture-request-123'});};
const shouldNotRun=async()=>{throw new Error('unexpected_provider_call');};
try{
 await store.discover(user,resource,randomUUID());
 await assert.rejects(store.embedResource(user,node,['secret fixture text'],reject),/KNOWLEDGE_EMBEDDING_HTTP_403/);
 const saved=(await pool.query('SELECT * FROM knowledge_embedding_rejections WHERE corp_id=$1',[user.corpId])).rows;
 assert.equal(saved.length,1);assert.equal(saved[0].input_hash,fingerprint(['secret fixture text']));
 assert.equal(JSON.stringify(saved).includes('secret fixture text'),false);results.push('refusal_persisted_without_input_or_body');
 await assert.rejects(new KnowledgeStore(pool,'fixture-model').embedResource(user,node,['secret fixture text'],shouldNotRun),/REJECTED_PENDING_RESOLUTION/);
 assert.equal(requests,1);results.push('new_process_instance_does_not_reissue');
 await assert.rejects(new KnowledgeStore(pool,'changed-model').embedResource(user,node,['changed content'],shouldNotRun),/REJECTED_PENDING_RESOLUTION/);
 results.push('parser_source_or_model_changes_do_not_clear_unresolved_refusal');
 const other={...user,userId:'other-fixture'};await store.discover(other,resource,randomUUID());
 const vectors=await store.embedResource(other,node,['fixture'],async()=>{requests++;return [[1]];});assert.deepEqual(vectors,[[1]]);
 results.push('different_employee_isolated');
 let release,entered;const waiting=new Promise(r=>{release=r;});const started=new Promise(r=>{entered=r;});
 const first=store.embedResource(other,node,['concurrent'],async()=>{entered();await waiting;return [[1]];});
 await started;await assert.rejects(store.embedResource(other,node,['concurrent'],shouldNotRun),/KNOWLEDGE_EMBEDDING_BUSY/);
 release();await first;results.push('concurrent_provider_submission_serialized');
 await assert.rejects(store.embedResource(other,node,['transient'],async()=>{throw new Error('KNOWLEDGE_EMBEDDING_HTTP_503');}),/HTTP_503/);
 assert.equal((await pool.query('SELECT 1 FROM knowledge_embedding_rejections WHERE corp_id=$1 AND user_id=$2',[other.corpId,other.userId])).rowCount,0);
 await store.embedResource(other,node,['after transient'],async()=>[[1]]);results.push('transient_failure_does_not_create_permanent_refusal');
 const report={kind:'actual_postgresql_with_provider_fixtures',passed:results,realModelCalls:0,dwsCalls:0};
 await writeFile('output/knowledge-diagnostics/embedding-guard-fixtures.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1',[user.corpId]);await pool.end();}
