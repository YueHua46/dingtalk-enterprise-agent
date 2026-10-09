// Real PostgreSQL isolation fixture; DWS authorization is covered separately.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {KnowledgeStore} from '../dist/knowledge-store.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const corp='sharing-fixture-'+randomUUID(),owner={corpId:corp,userId:'owner'},reader={corpId:corp,userId:'reader'};
const store=new KnowledgeStore(pool,'fixture-embedding',true,['owner']);
const resource={nodeId:'sharing-'+randomUUID(),workspaceId:'fixture-space',parentId:null,title:'Fixture',path:'Fixture',extension:'adoc',sourceUrl:'https://example.invalid',metadata:{},metadataHash:'metadata-fixture'};
const content={chunks:[{text:'fixture image evidence',position:{block:'image'},method:'vision'}],facts:[{model:'fixture',attribute:'power',value:'5V',position:{block:'image'},scope:'standard'}],quality:[]};
const results=[];
try{
 await store.discover(owner,resource,null);const version=await store.activate(owner,resource,content,[Array(1024).fill(1)],'source-fixture');
 assert.equal((await store.candidates(reader,'fixture',Array(1024).fill(1))).length,1);
 assert.equal(await store.sharedResource({...reader,corpId:corp+'-other'},resource.nodeId),undefined);
 assert.equal((await store.candidates({...reader,corpId:corp+'-other'},'fixture',Array(1024).fill(1))).length,0);
 results.push('same_corp_candidate_discovery_cross_corp_excluded');
 await store.discover(reader,resource,null);
 await assert.rejects(store.reuseVerifiedIndex(reader,resource,version,'changed-source'),/KNOWLEDGE_SHARED_SOURCE_CHANGED/);
 assert.equal((await store.resource(reader,resource.nodeId)).activeVersion,null);
 results.push('changed_source_cannot_activate');
 const own=await store.reuseVerifiedIndex(reader,resource,version,'source-fixture');assert.notEqual(own,version);
 assert.equal((await store.resource(reader,resource.nodeId)).activeVersion,own);
 const chunks=await pool.query('SELECT text FROM knowledge_chunks WHERE version_id=$1',[own]);assert.equal(chunks.rows[0].text,content.chunks[0].text);
 const facts=await pool.query('SELECT value FROM knowledge_facts WHERE version_id=$1',[own]);assert.equal(facts.rows[0].value,'5V');
 assert.equal(await store.reuseVerifiedIndex(reader,resource,version,'source-fixture'),own);
 results.push('private_version_vectors_facts_reused_idempotently');
 await store.state(owner,resource.nodeId,'denied');
 await assert.rejects(store.reuseVerifiedIndex(reader,resource,version,'source-fixture'),/KNOWLEDGE_SHARED_SOURCE_CHANGED/);
 results.push('revoked_index_not_reused');
 console.log(JSON.stringify({status:'passed',kind:'postgres_fixture_not_live_DWS',checks:results}));
}catch(e){process.exitCode=1;console.log(JSON.stringify({status:'failed',code:e.code??'assertion_failed'}));}
finally{await pool.query('DELETE FROM knowledge_resources WHERE corp_id=$1',[corp]);await pool.end();await writeFile('output/knowledge-pilot-deploy/sharing-postgres-results.json',JSON.stringify({kind:'postgres_fixture_not_live_DWS',checks:results,status:process.exitCode?'failed':'passed'},null,2));}
