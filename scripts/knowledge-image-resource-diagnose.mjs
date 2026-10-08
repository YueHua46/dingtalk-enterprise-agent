import {loadConfig} from '../dist/config.js';import {DwsBroker} from '../dist/dws-broker.js';import {documentImageReferences} from '../dist/knowledge-source.js';import {join} from 'node:path';import {homedir} from 'node:os';import {writeFile} from 'node:fs/promises';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')})),report=[];
for(const node of ['EpGBa2Lm8ajBR6mMco7xlXB3WgN7R35y','NZQYprEoWobMBvq0i0PRDLnq81waOeDk']){
 const entry={node,checkedAt:new Date().toISOString()};report.push(entry);
 try{const r=await dws.runCommand(user,['doc','+fetch','--node',node,'--scope','full','--detail','full'],{background:true});entry.complete=r.complete;
 const tree=typeof r.content.jsonml==='string'?JSON.parse(r.content.jsonml):r.content.jsonml;
 entry.references=documentImageReferences(tree).map(x=>({block:x.block,whiteboard:x.whiteboard,resourceIdType:typeof x.resourceId,resourceIdLength:x.resourceId?.length,validCurrent:x.resourceId? /^[A-Za-z0-9_-]{8,128}$/.test(x.resourceId):false}));
 const shapes=[];const shape=(v,d=0)=>v&&typeof v==='object'&&!Array.isArray(v)&&d<3?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x,d+1)])):Array.isArray(v)?'array':typeof v;
 const walk=v=>{if(!Array.isArray(v))return;if(/image|img/i.test(String(v[0])))shapes.push(shape(v[1]));v.slice(2).forEach(walk);};walk(tree);entry.imageAttributeShapes=shapes;
 const m=await dws.runCommand(user,['doc','+media-list','--node',node],{background:true});entry.mediaList={keys:Object.keys(m),count:m.count,mediaIsArray:Array.isArray(m.media),mediaCount:Array.isArray(m.media)?m.media.length:undefined};
 }catch(e){entry.failure={code:e.dwsCode,category:e.dwsCategory,reason:e.dwsReason};}
}
await writeFile('output/knowledge-diagnostics/image-resources-v5.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
