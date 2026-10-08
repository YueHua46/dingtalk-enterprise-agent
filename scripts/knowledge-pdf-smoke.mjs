import { Pool } from 'pg';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../dist/config.js';
import { DwsBroker } from '../dist/dws-broker.js';
import { KnowledgeModel } from '../dist/knowledge-model.js';
import { KnowledgeStore } from '../dist/knowledge-store.js';
import { KnowledgeSource } from '../dist/knowledge-source.js';
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1'});
const model=new KnowledgeModel(config),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),source=new KnowledgeSource(config,new DwsBroker(config),model,store);
const results=[];
try{
 const catalog=await pool.query(`SELECT corp_id,user_id,node_id FROM knowledge_resources WHERE title IN ('产品基础知识入门','How to add battery camera to NVR.202507')`);
 for(const row of catalog.rows){const start=Date.now();try{
  const user={corpId:row.corp_id,userId:row.user_id},resource=await store.resource(user,row.node_id),read=await source.read(user,resource,false);
  if(!read.content.chunks.length)throw new Error('KNOWLEDGE_PDF_NO_TEXT');
  const vectors=await store.embedResource(user,resource.nodeId,read.content.chunks.map(c=>resource.title+'\n'+c.text),input=>model.embed(input));
  const version=await store.activate(user,resource,read.content,vectors,read.hash);
  results.push({node:row.node_id,title:resource.title,status:'passed',version,chunks:read.content.chunks.length,quality:[...new Set(read.content.quality)],elapsedMs:Date.now()-start});
 }catch(e){results.push({node:row.node_id,status:'failed',code:/^KNOWLEDGE_[A-Z_0-9]+$/.test(e.message)?e.message:'parse_failed'});}}
 await writeFile('output/knowledge-acceptance-2026-09-30/pdf-results.json',JSON.stringify(results,null,2));
 if(!results.length||results.some(r=>r.status==='failed'))process.exitCode=1;
 console.log(JSON.stringify(results.map(r=>({title:r.title,status:r.status,chunks:r.chunks,elapsedMs:r.elapsedMs}))));
}finally{await pool.end();}
