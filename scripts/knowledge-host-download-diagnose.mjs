import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const c=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const p=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(p,c.EMBEDDING_MODEL),report={at:new Date().toISOString(),modelCalls:0,indexWrites:0};
try{
 const r=await store.resource(user,'dpYLaezmVNglK15EiaX67mlzJrMqPxX6'),s=new KnowledgeSource(c,new DwsBroker(c),new KnowledgeModel(c),store);
 const read=await s.read(user,r,false);Object.assign(report,{status:'source_read_passed',chunks:read.content.chunks.length});
}catch(e){Object.assign(report,{name:e.name,code:e.code,stage:e.sourceStage,frames:e.stack?.split('\n').slice(1,4),localMessage:/TypeError|ReferenceError/.test(e.name)?e.message:undefined});}
finally{await writeFile('output/knowledge-diagnostics/host-download-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await p.end();}
