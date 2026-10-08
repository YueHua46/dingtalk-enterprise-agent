import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {homedir} from 'node:os';import {join} from 'node:path';
import {loadConfig} from '../dist/config.js';import {KnowledgeModel} from '../dist/knowledge-model.js';
import {DwsBroker} from '../dist/dws-broker.js';import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';import {KnowledgeSync,knowledgeErrorCode} from '../dist/knowledge-sync.js';import {KnowledgeTool} from '../dist/knowledge-tool.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),checks=[];
try{
 const row=(await pool.query('SELECT corp_id,user_id FROM knowledge_resources WHERE node_id=$1',['QG53mjyd80ynBzl9HjN9dMrXW6zbX04v'])).rows[0];
 const user={corpId:row.corp_id,userId:row.user_id};
 const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',KNOWLEDGE_TEST_USERS:user.corpId+':'+user.userId});
 const model=new KnowledgeModel(config);let start=Date.now();
 const ranked=await model.rerank('摄像机离线后应该如何排查？',['财务报销需要提交发票。','先检查摄像机供电，再检查网络连接和路由器状态。','摄像机包装采用纸盒。']);
 checks.push({name:'actual_rerank_protocol',status:ranked[0]?.index===1?'passed':'failed',model:config.RERANK_MODEL,elapsedMs:Date.now()-start,ranking:ranked});
 const store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),source=new KnowledgeSource(config,new DwsBroker(config),model,store),sync=new KnowledgeSync(config,store,new DwsBroker(config),source,model),tool=new KnowledgeTool(config,store,sync,model);
 start=Date.now();const result=await tool.execute(user,'search',{query:'摄像机产品型号命名规则',limit:3});
 checks.push({name:'actual_DWS_verified_search_rerank',status:result.ranking.status==='passed'&&result.hits.length?'passed':'failed',elapsedMs:Date.now()-start,
   ranking:result.ranking,sources:result.hits.map(h=>({ref:h.source.ref,version:h.source.version,position:h.position,score:h.rerankScore})),gaps:result.coverageGaps,
   kind:'real_DWS_retrieval_not_DingTalk_message_or_accuracy_benchmark'});
}catch(e){checks.push({name:'rerank_smoke',status:'failed',code:knowledgeErrorCode(e)});}
finally{await pool.end();await writeFile('output/knowledge-acceptance-2026-09-30/rerank-results.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));if(checks.some(c=>c.status==='failed'))process.exitCode=1;}
