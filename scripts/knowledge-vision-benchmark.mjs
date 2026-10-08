// Actual current-user SOP screenshots, safe OCR masking, shared pool, and atomic indexing.
import {Pool} from 'pg';import {writeFile} from 'node:fs/promises';import {homedir} from 'node:os';import {join} from 'node:path';
import {loadConfig} from '../dist/config.js';import {DwsBroker} from '../dist/dws-broker.js';import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';import {KnowledgeSource} from '../dist/knowledge-source.js';import {KnowledgeSync,knowledgeErrorCode} from '../dist/knowledge-sync.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),results=[];
const concurrency=Number(process.argv.find(arg=>arg.startsWith('--concurrency='))?.split('=')[1]??process.env.KNOWLEDGE_VISION_CONCURRENCY??30);
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>64)throw new Error('KNOWLEDGE_CONCURRENCY_INVALID');
const parallel=process.argv.includes('--parallel'),minimum=parallel?Math.ceil(concurrency/2):concurrency;
let globalActive=0,globalPeak=0,releaseStart;
const ready=new Set(),startBarrier=parallel?new Promise(resolve=>{releaseStart=resolve;}):Promise.resolve();
const samples=(await pool.query(`SELECT r.corp_id,r.user_id,r.node_id,r.title FROM knowledge_resources r JOIN knowledge_versions v ON v.id=r.active_version
 WHERE r.extension='axls' AND r.status='ready' AND (SELECT count(*) FROM jsonb_array_elements_text(v.quality) q WHERE q='image_not_verified') BETWEEN $1 AND $2 ORDER BY r.title LIMIT 2`,[minimum,minimum+5])).rows;
if(parallel&&samples.length<2)releaseStart?.();
try{
 const runSample=async(sample)=>{
  const user={corpId:sample.corp_id,userId:sample.user_id};
  const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',KNOWLEDGE_TEST_USERS:user.corpId+':'+user.userId,KNOWLEDGE_VISION_CONCURRENCY:String(concurrency)});
  let active=0,peak=0;const times=[],httpStatuses={};let timeouts=0;
  const http=async(url,init)=>{
   const vision=String(url).endsWith('/responses');
   const start=Date.now();
   if(vision){active++;peak=Math.max(peak,active);globalActive++;globalPeak=Math.max(globalPeak,globalActive);}
   try{const response=await fetch(url,init);if(vision)httpStatuses[response.status]=(httpStatuses[response.status]??0)+1;return response;}
   catch(e){if(vision&&['TimeoutError','AbortError'].includes(e.name))timeouts++;throw e;}
   finally{if(vision){active--;globalActive--;times.push(Date.now()-start);}}
  };
  const model=new KnowledgeModel(config,http),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),source=new KnowledgeSource(config,new DwsBroker(config),model,store),sync=new KnowledgeSync(config,store,new DwsBroker(config),source,model);
  // Synchronize document batches before starting provider timeout clocks.
  if(parallel){const recognize=model.recognize.bind(model);model.recognize=async(data)=>{
    ready.add(sample.node_id);if(ready.size===samples.length)releaseStart?.();await startBarrier;return recognize(data);
  };}
  const resource=await store.resource(user,sample.node_id),start=Date.now();
  try{
   const result=await sync.refresh(user,resource,true);
   results.push({node:resource.nodeId,title:resource.title,status:'passed',version:result.version,elapsedMs:Date.now()-start,images:result.content.assets?.length??0,
    peakModelConcurrency:peak,modelRequests:times.length,modelMeanMs:times.reduce((a,b)=>a+b,0)/(times.length||1),chunks:result.content.chunks.length,httpStatuses,timeouts});
  }catch(e){releaseStart?.();results.push({node:resource.nodeId,title:resource.title,status:'failed',code:knowledgeErrorCode(e),elapsedMs:Date.now()-start,peakModelConcurrency:peak,modelRequests:times.length,httpStatuses,timeouts});}
  console.log(JSON.stringify(results.at(-1)));
 };
 if(parallel)await Promise.all(samples.map(runSample));else for(const sample of samples)await runSample(sample);
 for(const result of results)result.globalPeakModelConcurrency=globalPeak;
 await writeFile(`output/knowledge-full-ingestion/vision-benchmark-${concurrency}.json`,JSON.stringify(results,null,2));
}finally{await pool.end();if(!samples.length||results.some(r=>r.status==='failed'))process.exitCode=1;}
