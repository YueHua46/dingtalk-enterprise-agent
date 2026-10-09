// Real employee DWS permissions and existing acceptance index. No source edits,
// mocked tools, re-ingestion, or answers supplied to the language model.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {Pool} from 'pg';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeSync, knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {KnowledgeTool} from '../dist/knowledge-tool.js';

const profile=process.argv[2];
assert.match(profile??'',/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/,'EXPLICIT_EMPLOYEE_PROFILE_REQUIRED');
const [corpId,userId]=profile.split(':'), user={corpId,userId};
const output=resolve('output/knowledge-accuracy-2026-10-08');
await mkdir(output,{recursive:true});
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',LOG_LEVEL:'warn',
  KNOWLEDGE_ENABLED:'false',KNOWLEDGE_TEST_USERS:profile,KNOWLEDGE_AUTO_SYNC:'false',
  DWS_CONFIG_DIR:join(homedir(),'.dws'),KNOWLEDGE_DIR:resolve('data/knowledge-acceptance'),
  FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310'});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance',max:4});
const dws=new DwsBroker(config), model=new KnowledgeModel(config),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL,config.KNOWLEDGE_READY_ONLY==='true');
const source=new KnowledgeSource(config,dws,model,store),sync=new KnowledgeSync(config,store,dws,source,model),tool=new KnowledgeTool(config,store,sync,model);
let operations=[];
const run=dws.runCommand.bind(dws);
dws.runCommand=async(identity,args,options)=>{assert.deepEqual(identity,user);operations.push(args.slice(0,2).join(' '));return run(identity,args,options);};
const report={startedAt:new Date().toISOString(),scope:'real_employee_DWS_permissions_and_existing_acceptance_index',checks:[]};
const pdf='mExel2BLV5y5B7DNHbaAPQg7Vgk9rpMq',sheet='QG53mjyd80ynBzl9HjN9dMrXW6zbX04v';
async function check(name,fn){
  operations=[];const start=Date.now();
  try{const detail=await fn();report.checks.push({name,status:'passed',elapsedMs:Date.now()-start,detail,dws:operations});}
  catch(error){report.checks.push({name,status:'failed',elapsedMs:Date.now()-start,code:knowledgeErrorCode(error),assertion:error.code==='ERR_ASSERTION',dws:operations});process.exitCode=1;}
  console.log(JSON.stringify(report.checks.at(-1)));
  await writeFile(join(output,'position-live-results.json'),JSON.stringify(report,null,2));
}
try{
  assert(await dws.status(user,{fresh:true}),'DWS_AUTH_REQUIRED');
  const resource=await store.resource(user,pdf);assert(resource?.activeVersion);
  const chunks=(await pool.query('SELECT text,position,method FROM knowledge_chunks WHERE version_id=$1 ORDER BY ordinal',[resource.activeVersion])).rows;
  const page21=chunks.filter(c=>c.position.page===21);assert.equal(page21.length,5);
  const baseline=JSON.parse(await readFile(join(output,'baseline-results.json'),'utf8'));
  const prior=baseline.results.find(r=>r.id==='basic-01');
  const legacyCall=prior.calls.find(c=>c.operation==='read'&&c.input.position==='21');
  const legacy=chunks.filter(c=>JSON.stringify(c.position).includes('21'));
  const wrong=legacy.filter(c=>c.position.page!==21);
  report.baseline={fullApplicationElapsedMs:prior.elapsedMs,modelRequests:prior.modelRequests.length,
    modelElapsedMs:prior.modelRequests.reduce((sum,c)=>sum+c.elapsedMs,0),toolElapsedMs:prior.calls.reduce((sum,c)=>sum+c.elapsedMs,0),
    indexedVersionUnchanged:resource.activeVersion===legacyCall.result.source.version,legacyMatches:legacy.length,
    truePage21:page21.length,wrongPageMatches:wrong.length,wrongPages:[...new Set(wrong.map(c=>c.position.page))],
    wrongPageExample:wrong[0]?.position,legacyMatchesEqualRecordedE2E:legacy.length===legacyCall.result.chunks.length,
    pageColonRecordedChunks:prior.calls.find(c=>c.input.position==='page:21').result.chunks.length};
  assert(report.baseline.indexedVersionUnchanged);assert(report.baseline.legacyMatchesEqualRecordedE2E);
  for(const position of ['21','page:21','第21页',{page:21},'{"page":21}']){
    await check('pdf_page_'+JSON.stringify(position),async()=>{
      const result=await tool.execute(user,'read',{ref:pdf,position});
      assert.equal(result.chunks.length,page21.length);assert(result.chunks.every(c=>c.position.page===21));
      assert(result.chunks.some(c=>c.text.includes('存储')&&c.text.includes('性能')));
      return {position,chunks:result.chunks.length,pages:[...new Set(result.chunks.map(c=>c.position.page))],
        version:result.source.version,freshness:result.source.freshness};
    });
  }
  await check('pdf_missing_page_is_explicit',async()=>{
    const result=await tool.execute(user,'read',{ref:pdf,position:{page:999}});
    assert.equal(result.chunks.length,0);assert.equal(result.positionNotFound,true);
    return {chunks:0,positionNotFound:result.positionNotFound,availablePositions:result.availablePositions.length};
  });
  await check('pdf_legacy_full_citation_still_works',async()=>{
    const position=page21[0].position;
    const result=await tool.execute(user,'read',{ref:pdf,position:JSON.stringify(position)});
    assert(result.chunks.length>0&&result.chunks.every(c=>JSON.stringify(c.position)===JSON.stringify(position)));
    return {position,chunks:result.chunks.length};
  });
  for(const position of ['M系列!E4:F25',{sheet:'M系列',range:'E4:F25'},'{"range":"E3:F10","sheet":"M系列"}']){
    await check('sheet_range_'+JSON.stringify(position),async()=>{
      const result=await tool.execute(user,'read',{ref:sheet,position});assert(result.chunks.length>0);
      assert(result.chunks.every(c=>c.position.sheet==='M系列'));
      return {position,chunks:result.chunks.length,actualPositions:result.chunks.map(c=>c.position)};
    });
  }
  for(const product of [{model:'P42WC35-2-FASBT',value:'2.4G，802.11b/g/n'},{model:'P45HC35-3-FAS',value:'2.4G-5.8G 双频wifi'}]){
    await check('parameter_alias_'+product.model,async()=>{
      const result=await tool.execute(user,'lookup_product',{model:product.model,parameter:'WiFi'});
      assert(result.facts.some(f=>f.attribute==='无线标准'&&f.value===product.value));
      return {matchedParameters:result.matchedParameters,facts:result.facts.map(f=>({attribute:f.attribute,value:f.value,position:f.position}))};
    });
  }
  await check('document_scope_and_compact_search_coverage',async()=>{
    const result=await tool.execute(user,'search',{query:'2MP 8MP 像素 高像素 分辨率 要求 存储 码率',scope:pdf,limit:5});
    assert(result.hits.length>0);assert(result.hits.every(h=>h.source.ref===pdf));
    assert(!result.coverage.gaps);return {hits:result.hits.length,onlyRequestedDocument:true,
      resultChars:JSON.stringify(result).length,coverageChars:JSON.stringify(result.coverage).length};
  });
}finally{
  await pool.end();report.finishedAt=new Date().toISOString();
  await writeFile(join(output,'position-live-results.json'),JSON.stringify(report,null,2));
}
