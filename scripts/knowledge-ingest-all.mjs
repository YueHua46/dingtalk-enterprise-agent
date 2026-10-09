// Resumable full ingestion into the isolated knowledge database. Never writes DingTalk resources.
import {Pool} from 'pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {writeProgress,ingestionHasGaps} from './knowledge-progress.mjs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeSync,knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {fingerprint,knowledgeParserVersion} from '../dist/knowledge-parse.js';
import {runKnowledgePipeline} from '../dist/knowledge-pipeline.js';

const directory='output/knowledge-full-ingestion';await mkdir(directory,{recursive:true});
const profileList=JSON.parse((await promisify(execFile)(process.execPath,[join(process.env.APPDATA,'npm/node_modules/dingtalk-workspace-cli/bin/dws.js'),
 'profile','list','--format','json'],{env:{...process.env,DWS_CONFIG_DIR:join(homedir(),'.dws')}})).stdout);
const employeeFlag=process.argv.indexOf('--employee-profile');
const employeeProfile=employeeFlag<0?undefined:process.argv[employeeFlag+1];
if(employeeFlag>=0&&(!employeeProfile||!/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(employeeProfile)))throw new Error('KNOWLEDGE_TASK_IDENTITY_INVALID');
const profiles=(profileList.data?.profiles??profileList.profiles??[]).filter(p=>employeeProfile?p.profile===employeeProfile:p.isOrgCurrent===true);
if(profiles.length!==1)throw new Error('CURRENT_PROFILE_AMBIGUOUS');
const [corpId,userId]=profiles[0].profile.split(':');const user={corpId,userId};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),
 DATABASE_URL:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance',FILE_WORKER_URL:'http://127.0.0.1:18081',
 KNOWLEDGE_ENABLED:'false',KNOWLEDGE_TEST_USERS:corpId+':'+userId,CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const modelActivity={vision:{started:0,active:0,peak:0,completed:0,failed:0,lastRequestAt:null},embedding:{started:0,active:0,peak:0,completed:0,failed:0,lastRequestAt:null}};
const observedFetch=async(input,options)=>{
 const kind=String(input).endsWith('/embeddings')?'embedding':'vision',stats=modelActivity[kind];
 stats.started++;stats.active++;stats.peak=Math.max(stats.peak,stats.active);stats.lastRequestAt=new Date().toISOString();
 try{const response=await fetch(input,options);if(response.ok)stats.completed++;else stats.failed++;return response;}
 catch(error){stats.failed++;throw error;}finally{stats.active--;}
};
const pool=new Pool({connectionString:config.DATABASE_URL,max:8}),model=new KnowledgeModel(config,observedFetch),dws=new DwsBroker(config),
 store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),source=new KnowledgeSource(config,dws,model,store),sync=new KnowledgeSync(config,store,dws,source,model);
const retryFailed=process.argv.includes('--retry-failed');
const upgradeParser=process.argv.includes('--upgrade-parser');
const report={startedAt:new Date().toISOString(),updatedAt:null,phase:'starting',runMode:upgradeParser?'upgrade_parser':retryFailed?'retry_failed':'full',user,parser:knowledgeParserVersion,
 embeddingModel:config.EMBEDDING_MODEL,database:'isolated_acceptance_15432',concurrency:2,visionConcurrency:config.KNOWLEDGE_VISION_CONCURRENCY,modelActivity,counts:{},resources:{}};
let stopping=false,authFailed=false,saveTail=Promise.resolve();
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
async function save(){
 report.updatedAt=new Date().toISOString();const snapshot=JSON.stringify(report,null,2);
 saveTail=saveTail.then(()=>writeProgress(directory+'/progress.json',snapshot)).catch(error=>{
  console.error(JSON.stringify({event:'progress_write_failed',code:error.code??'unknown'}));
 });
 await saveTail;
}
async function summaries(){
 const {rows}=await pool.query('SELECT status,count(*)::int total FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 GROUP BY status',[corpId,userId]);
 report.databaseStates=Object.fromEntries(rows.map(r=>[r.status,r.total]));
}
async function processResource(item,phase){
   const start=Date.now(),resource=await store.resource(user,item.node_id),entry=report.resources[resource.nodeId]??={title:resource.title,extension:resource.extension};
   try{
    const old=await pool.query('SELECT v.parser_version,v.embedding_model,v.quality FROM knowledge_versions v WHERE v.id=$1',[resource.activeVersion??null]);
    if(resource.status==='ready'&&old.rows[0]?.parser_version===knowledgeParserVersion&&old.rows[0]?.embedding_model===config.EMBEDDING_MODEL&&
      (phase==='text'||!(old.rows[0].quality??[]).some(q=>/image_pending|image_not_verified/.test(q)))){
     entry[phase]={status:'skipped_current'};report.counts[phase].skipped++;
    }else{
     let result;
     if(phase==='text'){
      const read=await source.read(user,resource,false,new Set(),true);
      const vectors=await store.embedResource(user,resource.nodeId,read.content.chunks.map(c=>resource.title+'\n'+c.text),input=>model.embed(input));
      const latest=await source.read(user,resource,false,new Set(),true);
      if(latest.hash!==read.hash)throw new Error('KNOWLEDGE_SOURCE_CHANGED_DURING_PARSE');
      result={version:await store.activate(user,resource,read.content,vectors,read.hash),content:read.content};
     }else result=await sync.refresh(user,resource,true);
     entry[phase]={status:result.content.chunks.length?'passed':'needs_review',version:result.version,
      chunks:result.content.chunks.length,quality:[...new Set(result.content.quality)],elapsedMs:Date.now()-start};
     if(entry[phase].status==='needs_review')report.counts[phase].needsReview++;
     else report.counts[phase].passed++;
    }
   }catch(error){
    const code=knowledgeErrorCode(error);entry[phase]={status:'failed',code,elapsedMs:Date.now()-start,
      stage:/^[a-z_]{1,40}$/.test(error.sourceStage??'')?error.sourceStage:undefined,
      localErrorName:/^[A-Za-z]{1,40}$/.test(error.name??'')?error.name:undefined,
      localErrorCode:/^[A-Z_0-9]{1,80}$/.test(error.code??'')?error.code:undefined,
      localFrames:['TypeError','ReferenceError'].includes(error.name)?error.stack?.split('\n').slice(1,4):undefined,
      providerCode:error.providerCode,
      providerRequestId:error.providerRequestId,
      providerType:['new_api_error','server_error','upstream_error','overloaded_error','insufficient_quota','rate_limit_error','authentication_error','invalid_request_error'].includes(error.providerType)?error.providerType:undefined,
      providerFailure:['no_available_channel','insufficient_quota','capacity_exceeded'].includes(error.providerFailure)?error.providerFailure:undefined,
      modelStage:['response_headers','response_body'].includes(error.modelStage)?error.modelStage:undefined,
      modelElapsedMs:Number.isSafeInteger(error.modelElapsedMs)&&error.modelElapsedMs>=0?error.modelElapsedMs:undefined,
      modelAttempt:Number.isInteger(error.modelAttempt)&&error.modelAttempt>=1&&error.modelAttempt<=3?error.modelAttempt:undefined,
      modelImageOrdinal:Number.isSafeInteger(error.modelImageOrdinal)&&error.modelImageOrdinal>=1?error.modelImageOrdinal:undefined,
      modelImageHash:/^[a-f0-9]{64}$/.test(error.modelImageHash??'')?error.modelImageHash:undefined,
      dwsReason:error.dwsReason,
      dwsExitCode:Number.isInteger(error.dwsExitCode)?error.dwsExitCode:undefined,
      dwsStdoutBytes:Number.isSafeInteger(error.dwsStdoutBytes)?error.dwsStdoutBytes:undefined,
      dwsStderrBytes:Number.isSafeInteger(error.dwsStderrBytes)?error.dwsStderrBytes:undefined,
      dwsLocalFailure:['module_missing','binary_missing','spawn_not_found','spawn_denied'].includes(error.dwsLocalFailure)?error.dwsLocalFailure:undefined,
      dwsServerCode:error.dwsServerCode,
      dwsRequestId:error.dwsRequestId,
      dwsTransportKind:error.dwsTransportKind,
      dwsOperation:error.dwsOperation,
      exportStage:error.exportStage,
      dwsJobId:error.dwsJobId,
      dwsCauseCode:error.dwsCauseCode,
      dwsCategory:/^[a-z_]{1,40}$/i.test(error.dwsCategory??'')?error.dwsCategory:undefined,
      dwsCode:/^[A-Z_0-9.]{1,100}$/i.test(error.dwsCode??'')?error.dwsCode:undefined};report.counts[phase].failed++;
    await store.failure(user,resource.nodeId,code);
    if(code==='auth_required'){authFailed=true;await pool.query('UPDATE knowledge_users SET paused=true WHERE corp_id=$1 AND user_id=$2',[corpId,userId]);}
    if(code==='KNOWLEDGE_EMBEDDING_HTTP_403'&&error.providerCode==='AccessDenied.Unpurchased'){
      stopping=true;
      report.interruption={at:new Date().toISOString(),reason:'embedding_provider_AccessDenied.Unpurchased',checkpointPreserved:true};
    }
   }
   report.counts[phase].processed++;await summaries();await save();
   console.log(JSON.stringify({phase,node:resource.nodeId,...report.counts[phase]}));
   return entry[phase]?.status!=='failed';
}
const lock=await pool.connect(),key=fingerprint([corpId,userId]);
const heartbeat=setInterval(()=>{void save();},15_000);heartbeat.unref();
try{
 await save();if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 await store.enable(user);
 const providerDenied=await pool.query(`SELECT 1 FROM knowledge_embedding_rejections WHERE corp_id=$1 AND user_id=$2
   AND embedding_model=$3 AND provider_code='AccessDenied.Unpurchased' LIMIT 1`,[corpId,userId,config.EMBEDDING_MODEL]);
 if(providerDenied.rowCount)throw new Error('KNOWLEDGE_EMBEDDING_SERVICE_ACTIVATION_REQUIRED');
 // A fresh full directory scan precedes ingestion; it takes the normal scan lock.
 if(process.argv.includes('--resume')){
  const prior=await pool.query(`SELECT id,counts,finished_at FROM knowledge_sync_runs WHERE corp_id=$1 AND user_id=$2 AND directory_complete
    AND status='catalog_complete' AND finished_at>now()-interval '6 hours' ORDER BY finished_at DESC LIMIT 1`,[corpId,userId]);
  if(!prior.rows.length)throw new Error('KNOWLEDGE_RESUME_CATALOG_REQUIRED');
  report.catalog={directoryComplete:true,reusedRun:prior.rows[0].id,counts:prior.rows[0].counts,finishedAt:prior.rows[0].finished_at};
 }else{report.phase='catalog';await save();report.catalog=await sync.scan(user,{catalogOnly:true});}
 const locked=await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key]);
 if(!locked.rows[0].locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 const {rows}=await pool.query(`SELECT node_id FROM knowledge_resources r WHERE corp_id=$1 AND user_id=$2 AND status NOT IN ('directory_absent','deleted','denied')
  AND ((NOT $3::boolean AND NOT $4::boolean) OR ($3::boolean AND (status IN ('stale','pending','needs_review') OR EXISTS(
   SELECT 1 FROM knowledge_versions v WHERE v.id=r.active_version AND v.corp_id=$1 AND v.user_id=$2 AND v.quality::text~'image_pending|image_not_verified'))) OR ($4::boolean AND NOT EXISTS(
   SELECT 1 FROM knowledge_versions v WHERE v.id=r.active_version AND v.corp_id=$1 AND v.user_id=$2 AND v.parser_version=$5 AND v.embedding_model=$6)))
  ORDER BY CASE WHEN title='各产品参数资料' THEN 0 ELSE 1 END,extension,title`,[corpId,userId,retryFailed,upgradeParser,knowledgeParserVersion,config.EMBEDDING_MODEL]);
 const supported=[];
 const nodesFlag=process.argv.indexOf('--nodes'),nodes=nodesFlag<0?undefined:process.argv[nodesFlag+1]?.split(',');
 if(nodesFlag>=0&&(!nodes?.length||nodes.length>5||nodes.some(n=>!/^[A-Za-z0-9_-]{8,128}$/.test(n))))throw new Error('KNOWLEDGE_DIAGNOSTIC_NODES_INVALID');
 for(const row of rows){const resource=await store.resource(user,row.node_id);if(source.supported(resource)&&(!nodes||nodes.includes(row.node_id)))supported.push(row);}
 report.eligibleResources=supported.length;report.selectedNodes=rows.length;report.directoryNodes=report.catalog?.counts?.nodes??rows.length;await save();
 report.phase='text_and_images';
 for(const phase of ['text','images'])report.counts[phase]={total:supported.length,processed:0,passed:0,needsReview:0,failed:0,skipped:0};
 await save();
 await runKnowledgePipeline(supported,item=>processResource(item,'text'),async(item)=>{await processResource(item,'images');},
  {textConcurrency:2,imageConcurrency:2,shouldContinue:()=>!stopping&&!authFailed});
 report.phase=authFailed?'paused_auth':stopping?'interrupted':ingestionHasGaps(report.counts)?'completed_with_gaps':'completed';
 report.finishedAt=new Date().toISOString();await summaries();await save();
}catch(error){report.phase='failed';report.error=knowledgeErrorCode(error);await save();process.exitCode=1;}
finally{clearInterval(heartbeat);await saveTail;await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);lock.release();await pool.end();}
