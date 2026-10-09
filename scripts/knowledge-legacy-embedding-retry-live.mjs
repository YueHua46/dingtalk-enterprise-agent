import{Pool}from'pg';
import{homedir}from'node:os';
import{join}from'node:path';
import{writeFile}from'node:fs/promises';
import{loadConfig}from'../dist/config.js';
import{DwsBroker}from'../dist/dws-broker.js';
import{KnowledgeStore}from'../dist/knowledge-store.js';
import{KnowledgeSource}from'../dist/knowledge-source.js';
import{KnowledgeSync,knowledgeErrorCode,resourceFromNode}from'../dist/knowledge-sync.js';
import{KnowledgeModel}from'../dist/knowledge-model.js';
import{fingerprint}from'../dist/knowledge-parse.js';
if(!process.argv.includes('--confirmed-legacy-retry'))throw Error('EXPLICIT_AUTHORIZATION_REQUIRED');
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',KNOWLEDGE_ENABLED:'false',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),client=await pool.connect(),key=fingerprint([user.corpId,user.userId]);
const store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),model=new KnowledgeModel(config),dws=new DwsBroker(config),source=new KnowledgeSource(config,dws,model,store),sync=new KnowledgeSync(config,store,dws,source,model);
const defaultNodes=['amweZ92PV6yoBRgkH6r4YOPYWxEKBD6p','kDnRL6jAJMDrB1wESydaykakVyMoPYe1','XPwkYGxZV3y5BrvMHlKGPze48AgozOKL'];
const requested=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const nodes=requested.length?requested:defaultNodes;
const report={startedAt:new Date().toISOString(),kind:'explicitly_authorized_legacy_embedding_retries',nodes,results:[]};let locked=false;
const save=()=>writeFile('output/knowledge-diagnostics/legacy-embedding-retry-live.json',JSON.stringify(report,null,2));
try{
 locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw Error('DWS_OAUTH_REQUIRED');
 for(const node of nodes){
  const entry={node,startedAt:new Date().toISOString()};report.results.push(entry);await save();
  try{const old=await store.resource(user,node);if(!old||['denied','deleted','directory_absent'].includes(old.status))throw Error('KNOWLEDGE_SOURCE_EXCLUDED');
   const meta=await source.metadata(user,node),r=resourceFromNode(meta,old.workspaceId,old.path,old.parentId);await store.discover(user,r,null);
   const result=await sync.refresh(user,r,true);Object.assign(entry,{status:result.content.chunks.length?'passed':'needs_review',version:result.version,chunks:result.content.chunks.length,quality:result.content.quality});
  }catch(e){const code=knowledgeErrorCode(e);Object.assign(entry,{status:'failed',code,providerCode:e.providerCode,providerRequestId:e.providerRequestId,stage:e.sourceStage});await store.state(user,node,code==='permission_denied'?'denied':'stale',code);}
  entry.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(entry));
 }
}finally{report.finishedAt=new Date().toISOString();await save();if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();await pool.end();}
