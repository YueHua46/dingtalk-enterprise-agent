// Real failed sources, actual sandbox and provider calls. No source writes.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {writeFile,mkdir} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeSync,knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {fingerprint,knowledgeParserVersion} from '../dist/knowledge-parse.js';
const inline=process.argv.includes('--inline');
if(inline&&!process.argv.includes('--vision'))throw new Error('INLINE_ACCEPTANCE_REQUIRES_VISION');
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',
 FILE_WORKER_URL:'http://127.0.0.1:18081',KNOWLEDGE_TEST_USERS:user.corpId+':'+user.userId,KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),dws=new DwsBroker(config),model=new KnowledgeModel(config),source=new KnowledgeSource(config,dws,model,store),sync=new KnowledgeSync(config,store,dws,source,model);
const report=[],lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]);
await mkdir('output/knowledge-diagnostics',{recursive:true});
try{
 const locked=await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key]);if(!locked.rows[0].locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 const nodes=inline?['EpGBa2Lm8ajBR6mMco7xlXB3WgN7R35y','NZQYprEoWobMBvq0i0PRDLnq81waOeDk']:process.argv.includes('--native')?['14lgGw3P8vLdqkgAT7z7zLP7V5daZ90D']:process.argv.includes('--ocr')?['vy20BglGWOMn41qAhqGAM3oRJA7depqY']:process.argv.includes('--pdf')?['kDnRL6jAJMDrB1wESydaykakVyMoPYe1','amweZ92PV6yoBRgkH6r4YOPYWxEKBD6p']:process.argv.includes('--only-upstream')?['93NwLYZXWybGq2NAiYO2eyXDVkyEqBQm']:['gvNG4YZ7JnbrA45Riy9b66xXJ2LD0oRE','93NwLYZXWybGq2NAiYO2eyXDVkyEqBQm','lyQod3RxJKvLB1OEsdQPPEBBVkb4Mw9r'];
 for(const node of nodes){
  const resource=await store.resource(user,node),entry={node,title:resource.title,parser:knowledgeParserVersion,startedAt:new Date().toISOString()};report.push(entry);
  try{
   const read=await source.read(user,resource,false,new Set(),true);
   entry.textChunks=read.content.chunks.length;entry.unrecognizedImages=read.content.quality.filter(q=>q==='image_not_verified').length+new Set(read.content.quality.filter(q=>q.startsWith('image_pending:'))).size;
   entry.manifestStatus='passed';console.log(JSON.stringify(entry));
   if(process.argv.includes('--vision')){
    const result=await sync.refresh(user,resource,true);entry.version=result.version;entry.images=result.content.assets?.length??0;
    if(inline){
     if(entry.images!==1||!result.content.chunks.length||result.content.quality.some(q=>/image_pending|image_not_verified|no_text/.test(q)))throw new Error('KNOWLEDGE_INLINE_ACCEPTANCE_INCOMPLETE');
     const active=await store.resource(user,node);
     const version=await pool.query('SELECT parser_version FROM knowledge_versions WHERE id=$1 AND corp_id=$2 AND user_id=$3',[result.version,user.corpId,user.userId]);
     if(active.activeVersion!==result.version||active.status!=='ready'||version.rows[0]?.parser_version!==knowledgeParserVersion)throw new Error('KNOWLEDGE_INLINE_ACTIVATION_UNVERIFIED');
    }
    entry.status='passed';
   }else entry.status='manifest_only_passed';
  }catch(error){process.exitCode=1;entry.status='failed';entry.code=knowledgeErrorCode(error);entry.stage=error.sourceStage;entry.providerCode=error.providerCode;entry.providerRequestId=error.providerRequestId;entry.errorName=error.name;entry.causeName=error.cause?.name;entry.causeCode=String(error.cause?.code??error.cause?.cause?.code??'').replace(/[^A-Za-z0-9_]/g,'').slice(0,100);
   entry.modelStage=['response_headers','response_body'].includes(error.modelStage)?error.modelStage:undefined;
   entry.providerType=['new_api_error','server_error','upstream_error','overloaded_error','insufficient_quota','rate_limit_error','authentication_error','invalid_request_error'].includes(error.providerType)?error.providerType:undefined;
   entry.providerFailure=['no_available_channel','insufficient_quota','capacity_exceeded'].includes(error.providerFailure)?error.providerFailure:undefined;
   entry.modelElapsedMs=Number.isSafeInteger(error.modelElapsedMs)&&error.modelElapsedMs>=0?error.modelElapsedMs:undefined;
   entry.modelAttempt=Number.isInteger(error.modelAttempt)&&error.modelAttempt>=1&&error.modelAttempt<=3?error.modelAttempt:undefined;
   entry.modelImageOrdinal=Number.isSafeInteger(error.modelImageOrdinal)&&error.modelImageOrdinal>=1?error.modelImageOrdinal:undefined;
   entry.modelImageHash=/^[a-f0-9]{64}$/.test(error.modelImageHash??'')?error.modelImageHash:undefined;
  }
  entry.finishedAt=new Date().toISOString();await writeFile('output/knowledge-diagnostics/'+(inline?'inline-svg-model-live-v6':process.argv.includes('--native')?'native-live-v5':process.argv.includes('--ocr')?'ocr-live-v4':process.argv.includes('--pdf')?'pdf-live':process.argv.includes('--only-upstream')?'upstream-live':'parser-live')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(entry));
 }
}finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>{});lock.release();await pool.end();}
