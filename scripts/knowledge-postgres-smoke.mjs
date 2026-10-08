// Database correctness fixtures are not real DingTalk permission acceptance.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {writeFile} from 'node:fs/promises';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(pool,'qwen3.7-text-embedding');
const user={corpId:'db-fixture-'+randomUUID(),userId:'db-test-only'},node='db-fixture-'+randomUUID();
const resource={nodeId:node,workspaceId:'db-fixture-space',parentId:null,title:'DB fixture',path:'DB fixture',extension:'adoc',sourceUrl:'https://example.invalid/fixture',metadata:{},metadataHash:fingerprint('v1')};
const results=[];
const content=text=>({chunks:[{text,position:{block:'fixture'},method:'database_test_only'}],facts:[],quality:[]});
try{
 await store.discover(user,resource,randomUUID());
 let recognitions=0;
 const recognize=async()=>{recognitions++;return 'safe recognized text';};
 assert.equal(await store.recognizedImage(user,node,'digest','model-a',recognize),'safe recognized text');
 await store.recognizedImage(user,node,'digest','model-a',recognize);assert.equal(recognitions,1);
 await store.recognizedImage(user,node,'digest-new','model-a',recognize);assert.equal(recognitions,2);
 await store.recognizedImage(user,node,'digest','model-b',recognize);assert.equal(recognitions,3);
 await assert.rejects(store.recognizedImage(user,node,'failed-digest','model-a',async()=>{throw new Error('provider_failed');}));
 const checkpoint=await pool.query("SELECT count(*)::int total FROM knowledge_image_results WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND digest='failed-digest'",[user.corpId,user.userId,node]);assert.equal(checkpoint.rows[0].total,0);
 const otherUser={...user,userId:'other-user'};await store.discover(otherUser,resource,randomUUID());
 await store.recognizedImage(otherUser,node,'digest','model-a',recognize);assert.equal(recognitions,4);
 await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2',[otherUser.corpId,otherUser.userId]);
 results.push({name:'image_checkpoint_hash_model_employee_scope_and_no_failed_cache',status:'passed',kind:'database_fixture'});
 const first=await store.activate(user,resource,content('version one'),[Array(1024).fill(1)],fingerprint('one'));
 const second=await store.activate(user,resource,content('version two'),[Array(1024).fill(2)],fingerprint('two'));
 assert.notEqual(first,second);assert.equal((await store.resource(user,node)).activeVersion,second);
 const old=await pool.query('SELECT retired_at FROM knowledge_versions WHERE id=$1',[first]);assert(old.rows[0].retired_at);
 results.push({name:'atomic_active_version_and_retirement',status:'passed',kind:'database_fixture'});
 await assert.rejects(store.activate(user,resource,content('invalid'),[Array(1023).fill(1)],fingerprint('invalid')));
 assert.equal((await store.resource(user,node)).activeVersion,second);
 const versions=await pool.query('SELECT count(*)::int total FROM knowledge_versions WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);assert.equal(versions.rows[0].total,2);
 results.push({name:'failed_vector_insert_rolls_back_entire_version',status:'passed',kind:'database_fixture'});
 await pool.query('UPDATE knowledge_versions SET parser_version=$2 WHERE id=$1',[second,'old-parser-fixture']);
 assert.equal(await store.discover(user,resource,randomUUID()),true);
 results.push({name:'parser_upgrade_reindexes_unchanged_document',status:'passed',kind:'database_fixture'});
 assert.equal((await store.candidates({...user,userId:'another-user'},'version',Array(1024).fill(1))).length,0);
 results.push({name:'user_sql_scope',status:'passed',kind:'database_fixture_not_independent_DWS_account'});
 await store.state(user,node,'denied');assert.equal((await store.candidates(user,'version',Array(1024).fill(1))).length,0);
 results.push({name:'denied_cache_not_recalled',status:'passed',kind:'database_fixture'});
}catch(e){results.push({name:'database_smoke',status:'failed',code:e.code??'assertion_failed'});process.exitCode=1;}
finally{await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);await pool.end();await writeFile('output/knowledge-acceptance-2026-09-30/database-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
