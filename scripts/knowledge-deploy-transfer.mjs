// Explicit one-employee transfer into an empty production knowledge index.
// No task tables, authorization credentials, queues or company files changed.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const profile=process.argv[2];
assert.match(profile??'',/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/);
const [corpId,userId]=profile.split(':');
const tables=['knowledge_resources','knowledge_versions','knowledge_chunks','knowledge_facts','knowledge_assets',
 'knowledge_relations','knowledge_image_results','knowledge_embedding_rejections','knowledge_users','knowledge_sync_runs',
 'knowledge_exports','knowledge_sheet_exports','knowledge_export_events'];
const importer=`import {Pool} from 'pg';import {createInterface} from 'node:readline';
const pool=new Pool({connectionString:process.env.DATABASE_URL});const c=await pool.connect();
const allowed=${JSON.stringify(tables)};
try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('rag-initial-deployment'))");
if(Number((await c.query('SELECT count(*) FROM knowledge_resources')).rows[0].count)!==0)throw Error('PRODUCTION_INDEX_NOT_EMPTY');
for await(const line of createInterface({input:process.stdin})){const {table,rows}=JSON.parse(line);
if(!allowed.includes(table)||!Array.isArray(rows))throw Error('INVALID_TRANSFER_TABLE');
await c.query('INSERT INTO '+table+' SELECT * FROM jsonb_populate_recordset(NULL::'+table+',$1::jsonb)',[JSON.stringify(rows)]);}
await c.query("SELECT setval(pg_get_serial_sequence('knowledge_export_events','id'),COALESCE((SELECT max(id) FROM knowledge_export_events),1),(SELECT count(*)>0 FROM knowledge_export_events))");
await c.query('COMMIT');console.log(JSON.stringify({committed:true,resources:(await c.query('SELECT count(*)::int FROM knowledge_resources')).rows[0].count}));
}catch(e){await c.query('ROLLBACK');console.error(e.message);process.exitCode=1;}finally{c.release();await pool.end();}`;
const source=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const child=spawn('docker',['exec','-i','dingtalk-enterprise-agent-gateway-1','node','--input-type=module','-e',importer],{windowsHide:true,stdio:['pipe','inherit','inherit']});
const completed=once(child,'exit');
try{
 for(const table of tables){
  const childTable=['knowledge_chunks','knowledge_facts','knowledge_assets'].includes(table);
  const predicate=childTable?'EXISTS (SELECT 1 FROM knowledge_versions v WHERE v.id=t.version_id AND v.corp_id=$1 AND v.user_id=$2)':'t.corp_id=$1 AND t.user_id=$2';
  const {rows}=await source.query('SELECT to_jsonb(t) AS row FROM '+table+' t WHERE '+predicate,[corpId,userId]);
  for(let i=0;i<rows.length;i+=100){if(!child.stdin.write(JSON.stringify({table,rows:rows.slice(i,i+100).map(r=>r.row)})+'\n'))await once(child.stdin,'drain');}
  console.log(JSON.stringify({table,rows:rows.length}));
 }
 child.stdin.end();const [code]=await completed;assert.equal(code,0,'INDEX_TRANSFER_FAILED');
}finally{await source.end();if(!child.stdin.writableEnded)child.stdin.end();}
