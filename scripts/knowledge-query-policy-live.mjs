// Real employee DWS, PostgreSQL, embedding and rerank; no provider fixtures.
// Uses only the isolated acceptance database and never writes DingTalk content.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeSync,knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {KnowledgeTool} from '../dist/knowledge-tool.js';
import {mapConcurrent} from '../dist/knowledge-concurrency.js';

const profile=process.argv[2];
if(!/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(profile??''))throw Error('EXPLICIT_EMPLOYEE_PROFILE_REQUIRED');
const [corpId,userId]=profile.split(':'),user={corpId,userId};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',KNOWLEDGE_ENABLED:'false',KNOWLEDGE_TEST_USERS:profile,
  KNOWLEDGE_AUTO_SYNC:'false',KNOWLEDGE_QUERY_BUDGET_MS:'120000',DWS_CONFIG_DIR:join(homedir(),'.dws'),
  FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance',max:6});
const output='output/knowledge-query-policy';await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),kind:'real_employee_DWS_and_models_with_acceptance_index_not_DingTalk_message_delivery',checks:[]};
let trace=[];
const dws=new DwsBroker(config),run=dws.runCommand.bind(dws);
dws.runCommand=async(identity,args,options)=>{assert.deepEqual(identity,user);trace.push({kind:'dws',operation:args.slice(0,2).join(' ')});return run(identity,args,options);};
const model=new KnowledgeModel(config);
const embed=model.embed.bind(model);model.embed=async(input)=>{trace.push({kind:'embedding',count:input.length});return embed(input);};
const rerank=model.rerank.bind(model);model.rerank=async(query,documents)=>{trace.push({kind:'rerank',count:documents.length});return rerank(query,documents);};
function ports(db,readyOnly=false){
  const store=new KnowledgeStore(db,config.EMBEDDING_MODEL,readyOnly),source=new KnowledgeSource(config,dws,model,store),read=source.read.bind(source);
  source.read=async(...args)=>{trace.push({kind:'source_read',node:args[1].nodeId,vision:args[2]??true});return read(...args);};
  const sync=new KnowledgeSync({...config,KNOWLEDGE_READY_ONLY:String(readyOnly)},store,dws,source,model);
  return {store,source,sync,tool:new KnowledgeTool({...config,KNOWLEDGE_READY_ONLY:String(readyOnly)},store,sync,model)};
}
const {store,tool}=ports(pool);
const snapshot=async(node)=>(await pool.query('SELECT active_version,status,error_code,verified_at FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[corpId,userId,node])).rows[0];
const check=async(name,fn)=>{
  trace=[];const start=Date.now();
  try{const detail=await fn();const result={name,status:'passed',elapsedMs:Date.now()-start,detail,trace};report.checks.push(result);console.log(JSON.stringify(result));}
  catch(error){report.checks.push({name,status:'failed',elapsedMs:Date.now()-start,code:knowledgeErrorCode(error),assertion:error.code==='ERR_ASSERTION',trace});console.log(JSON.stringify(report.checks.at(-1)));process.exitCode=1;}
  await writeFile(output+(process.argv.includes('--probe')?'/probe-results.json':'/live-results.json'),JSON.stringify(report,null,2));
};
let temporaryPool,temporarySchema;
try{
  assert(await dws.status(user,{fresh:true}));
  const parameter=(await pool.query(`SELECT r.node_id,f.model,f.attribute,f.value FROM knowledge_resources r
    JOIN knowledge_facts f ON f.version_id=r.active_version WHERE r.corp_id=$1 AND r.user_id=$2 AND r.title='各产品参数资料'
    ORDER BY (f.attribute='APP') DESC,f.model,f.attribute LIMIT 1`,[corpId,userId])).rows[0];
  const document=(await pool.query(`SELECT node_id FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND title='产品型号命名规则'`,[corpId,userId])).rows[0];
  assert(parameter&&document,'REAL_SOURCES_REQUIRED');
  await check('ordinary_product_uses_index_without_body_read_or_timestamp_refresh',async()=>{
    const before=await snapshot(parameter.node_id);
    const result=await tool.execute(user,'lookup_product',{model:parameter.model,parameter:parameter.attribute});
    assert(result.facts.some(f=>f.value===parameter.value&&f.source.freshness==='indexed'));
    assert.equal(trace.filter(t=>t.kind==='source_read').length,0);
    assert.equal(trace.filter(t=>t.kind==='embedding').length,0);
    const after=await snapshot(parameter.node_id);assert.deepEqual(after,before);
    return {facts:result.facts.length,correctValue:true,source:result.facts[0].source,gaps:result.coverageGaps,before,after};
  });
  await check('ordinary_read_and_followup_do_not_download_source',async()=>{
    const context={surfaceId:'rag-policy-live',taskId:'policy-'+randomUUID()};
    const result=await tool.execute(user,'read',{ref:document.node_id},context);
    assert(result.chunks.length&&result.source.freshness==='indexed');
    assert(await tool.contextValid(user,context.surfaceId));
    assert.equal(trace.filter(t=>t.kind==='source_read').length,0);
    await pool.query('DELETE FROM knowledge_dependencies WHERE corp_id=$1 AND user_id=$2 AND surface_id=$3',[corpId,userId,context.surfaceId]);
    return {chunks:result.chunks.length,followupValid:true};
  });
  await check('hybrid_search_real_candidates_and_rerank',async()=>{
    let candidateCount=0;const candidates=store.candidates.bind(store);
    store.candidates=async(...args)=>{const result=await candidates(...args);candidateCount=result.length;return result;};
    try{
      const result=await tool.execute(user,'search',{query:'摄像机产品型号命名规则',limit:10});
      assert(result.hits.some(h=>h.source.ref===document.node_id));
      assert.equal(trace.filter(t=>t.kind==='source_read').length,0);
      return {candidateCount,hits:result.hits.length,rerankDocuments:trace.filter(t=>t.kind==='rerank').at(-1)?.count,sources:result.hits.map(h=>({ref:h.source.ref,freshness:h.source.freshness})),ranking:result.ranking};
    }finally{store.candidates=candidates;}
  });
  if(process.argv.includes('--probe')){report.probeOnly=true;}
  else{
    await check('40_real_parameter_queries_verify_value_and_cell',async()=>{
      const facts=(await pool.query(`SELECT f.* FROM knowledge_facts f JOIN knowledge_resources r ON r.active_version=f.version_id
        WHERE r.corp_id=$1 AND r.user_id=$2 AND r.node_id=$3 ORDER BY f.model,f.attribute LIMIT 40`,[corpId,userId,parameter.node_id])).rows;
      assert.equal(facts.length,40);let completed=0;
      const results=await mapConcurrent(facts,2,async fact=>{
        const result=await tool.execute(user,'lookup_product',{model:fact.model,parameter:fact.attribute});completed++;
        if(completed%10===0)console.log(JSON.stringify({progress:'real_parameter_queries',completed,total:40}));
        return result.facts.some(f=>f.value===fact.value&&JSON.stringify(f.position)===JSON.stringify(fact.position)&&f.source.freshness==='indexed');
      });
      assert.equal(results.filter(Boolean).length,40);assert.equal(trace.filter(t=>t.kind==='source_read').length,0);
      return {correct:40,total:40,scope:'structured_parameter_values_and_cells_not_all_RAG_questions'};
    });
    await check('latest_sheet_reports_actual_pending_export_and_never_returns_index_as_current',async()=>{
      const journal=(await pool.query('SELECT state,job_id,stage,diagnostic FROM knowledge_sheet_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[corpId,userId,parameter.node_id])).rows[0];
      assert(journal&&journal.state==='failed'&&journal.job_id===null,'EXPECTED_REAL_PENDING_EXPORT');
      const before=await snapshot(parameter.node_id);
      const result=await tool.execute(user,'lookup_product',{model:parameter.model,parameter:parameter.attribute,freshness:'latest'});
      assert.equal(result.facts.length,0);assert(result.coverageGaps.some(g=>g.reason==='KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION'));
      const after=await snapshot(parameter.node_id);assert.equal(after.active_version,before.active_version);assert.equal(after.status,before.status);assert.deepEqual(after.verified_at,before.verified_at);
      assert(!trace.some(t=>t.operation?.includes('export-submit')));
      return {facts:0,gaps:result.coverageGaps,journal,statePreserved:true,contentVerificationTimestampPreserved:true};
    });
    await check('latest_reads_real_document_builds_vectors_then_serves_normal_query',async()=>{
      // A fresh isolated index forces actual source -> embedding -> activation;
      // the company document itself is read-only and is not edited for this test.
      temporarySchema='rag_policy_'+randomUUID().replaceAll('-','');
      await pool.query(`CREATE SCHEMA ${temporarySchema}`);
      const tables=['knowledge_resources','knowledge_versions','knowledge_chunks','knowledge_facts','knowledge_assets','knowledge_embedding_rejections','knowledge_image_results','knowledge_relations','knowledge_dependencies'];
      for(const table of tables)await pool.query(`CREATE TABLE ${temporarySchema}.${table} (LIKE public.${table} INCLUDING ALL)`);
      temporaryPool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance',options:'-c search_path='+temporarySchema+',public',max:4});
      const p=ports(temporaryPool,true),resource=await store.resource(user,document.node_id);
      await p.store.discover(user,resource,null);assert.equal((await p.store.resource(user,resource.nodeId)).activeVersion,null);
      const result=await p.tool.execute(user,'read',{ref:resource.nodeId,freshness:'latest'});
      assert(result.chunks.length&&result.source.freshness==='current');assert.equal(result.source.version,(await p.store.resource(user,resource.nodeId)).activeVersion);
      assert(trace.some(t=>t.kind==='embedding'));
      const db=(await temporaryPool.query('SELECT count(*)::int total FROM knowledge_chunks WHERE version_id=$1',[result.source.version])).rows[0];
      const latestTrace=[...trace];trace=[];
      const normal=await p.tool.execute(user,'search',{query:'产品型号命名规则',limit:3});
      assert(normal.hits.length&&normal.hits.every(h=>h.source.version===result.source.version&&h.source.freshness==='indexed'));
      assert.equal(trace.filter(t=>t.kind==='source_read').length,0);
      const normalTrace=[...trace];trace=[];
      let candidateQueries=0;const candidates=p.store.candidates.bind(p.store);
      p.store.candidates=async(...args)=>{candidateQueries++;return candidates(...args);};
      const liveSearch=await p.tool.execute(user,'search',{query:'产品型号命名规则',limit:3,freshness:'latest'});
      assert(liveSearch.hits.length&&liveSearch.hits.every(h=>h.source.freshness==='current'));
      assert.equal(candidateQueries,2,'LATEST_MUST_QUERY_ACTIVATED_INDEX');
      const liveSearchTrace=[...trace];trace=[];
      const context={surfaceId:'isolated-policy',taskId:'repeat-latest-'+randomUUID()};
      await p.tool.execute(user,'read',{ref:resource.nodeId,freshness:'latest'},context);
      await p.tool.execute(user,'read',{ref:resource.nodeId,freshness:'latest'},context);
      assert.equal(trace.filter(t=>t.kind==='source_read').length,2,'LATEST_MUST_NOT_REUSE_TASK_RESULT');
      return {source:result.source,vectorChunks:db.total,normalHits:normal.hits.length,latestTrace,normalTrace,liveSearchTrace,candidateQueries,repeatedLatestBodyReads:2,scope:'real_existing_source_first_index_and_lookup_not_source_edit_test'};
    });
  }
}finally{
  if(temporaryPool)await temporaryPool.end();
  if(temporarySchema)await pool.query(`DROP SCHEMA ${temporarySchema} CASCADE`);
  await pool.end();report.finishedAt=new Date().toISOString();await writeFile(output+(process.argv.includes('--probe')?'/probe-results.json':'/live-results.json'),JSON.stringify(report,null,2));
}
