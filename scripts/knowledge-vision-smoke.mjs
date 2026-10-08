import {Pool} from 'pg';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
let result;const started=Date.now();
try{
 const {rows}=await pool.query(`SELECT corp_id,user_id,node_id FROM knowledge_resources WHERE title='安佳 M系列 RTMP直播设置' LIMIT 1`);
 if(!rows.length)throw new Error('fixture_missing');const row=rows[0],user={corpId:row.corp_id,userId:row.user_id};
 const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1'});
 const model=new KnowledgeModel(config),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),source=new KnowledgeSource(config,new DwsBroker(config),model,store),r=await store.resource(user,row.node_id);
 const read=await source.read(user,r,true);
 if(!read.content.chunks.length||!read.content.assets?.length)throw new Error('vision_empty');
 await writeFile('output/knowledge-acceptance-2026-09-30/vision-source-redacted.jpg',Buffer.from(read.content.assets[0].dataUrl.split(',')[1],'base64'));
 const vectors=await store.embedResource(user,r.nodeId,read.content.chunks.map(c=>c.text),input=>model.embed(input));const version=await store.activate(user,r,read.content,vectors,read.hash);
 await writeFile('output/knowledge-acceptance-2026-09-30/vision-evidence.json',JSON.stringify({node:r.nodeId,version,chunks:read.content.chunks},null,2));
 result={status:'passed',node:r.nodeId,version,elapsedMs:Date.now()-started,chunks:read.content.chunks.length,model:config.MODEL_NAME,kind:'single_actual_source_image_not_all_visual_acceptance'};
}catch(e){result={status:'failed',code:/^KNOWLEDGE_[A-Z_0-9]+$/.test(e.message)?e.message:'vision_failed',elapsedMs:Date.now()-started};}
finally{await writeFile('output/knowledge-acceptance-2026-09-30/vision-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.status==='failed')process.exitCode=1;await pool.end();}
