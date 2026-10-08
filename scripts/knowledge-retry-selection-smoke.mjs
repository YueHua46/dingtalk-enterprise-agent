// Actual PostgreSQL execution of the bulk selection query against CTE fixtures.
// No resources, permissions, models or DWS endpoints are mutated.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
const script=await readFile('scripts/knowledge-ingest-all.mjs','utf8');
const sql=script.match(/pool\.query\(`(SELECT node_id FROM knowledge_resources[\s\S]*?ORDER BY[\s\S]*?)`,\[corpId,userId,retryFailed/)?.[1];
assert(sql,'bulk query not found');
const fixture=`WITH knowledge_resources AS (
 SELECT 'corp'::text corp_id,'employee'::text user_id,id node_id,status,'current'::text active_version,'axls'::text extension,id title
 FROM (VALUES ('review','needs_review'),('stale','stale'),('ready','ready'),('denied','denied'),('deleted','deleted'),('absent','directory_absent')) x(id,status)
), knowledge_versions AS (
 SELECT 'current'::text id,'corp'::text corp_id,'employee'::text user_id,'knowledge-v6'::text parser_version,'fixture-model'::text embedding_model,'[]'::jsonb quality
) `;
const p=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
try{
 const r=await p.query(fixture+sql,['corp','employee',true,true,'knowledge-v6','fixture-model']);
 assert.deepEqual(r.rows.map(x=>x.node_id).sort(),['review','stale']);
 const report={checkedAt:new Date().toISOString(),status:'passed',selected:r.rows.map(x=>x.node_id),fixture:true,dwsCalls:0,modelCalls:0,indexWrites:0};
 await writeFile('output/knowledge-diagnostics/retry-selection-fixture.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await p.end();}
