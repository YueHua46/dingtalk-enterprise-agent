import {loadConfig} from '../dist/config.js';import {DwsBroker} from '../dist/dws-broker.js';import {join} from 'node:path';import {homedir} from 'node:os';import {writeFile} from 'node:fs/promises';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const report=[];
for(const node of ['ydxXB52LJqekqDKYt3r61AGpJqjMp697','QG53mjyd80ynBzl9HQZrN3bBW6zbX04v']){
 const r=await dws.runCommand(user,['doc','+fetch','--node',node,'--scope','full','--detail','full'],{background:true});
 const tree=typeof r.content.jsonml==='string'?JSON.parse(r.content.jsonml):r.content.jsonml;const cards=[];
 const shape=(v,depth=0)=>v&&typeof v==='object'&&!Array.isArray(v)&&depth<3?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x,depth+1)])):Array.isArray(v)?'array':typeof v;
 const walk=v=>{if(!Array.isArray(v))return;if(v[0]==='card'&&v[1]?.cardType==='hetu')cards.push({block:v[1].uuid??v[1].id,shape:shape(v[1]),partId:v[1].whiteboardId??v[1].partId??v[1].extraData?.whiteboardId??v[1].extraData?.partId??v[1].metadata?.id});v.slice(2).forEach(walk);};walk(tree);
 const e={node,complete:r.complete,cards};report.push(e);
 for(const c of cards){if(!c.partId)continue;try{const q=await dws.runCommand(user,['whiteboard','+query','--node',node,'--part-id',c.partId],{background:true});c.queryKeys=Object.keys(q);c.returnedNode=q.nodeId;c.returnedPart=q.partId;c.verified=q.verified;const s=q.source??q.data?.source;c.sourceShape=shape(s);c.pages=s?.pages?.map(p=>({id:p.id,nodes:p.nodes?.length,types:p.nodes?.reduce((counts,n)=>({...counts,[n.type]:(counts[n.type]??0)+1}),{})}));}catch(error){c.failure={code:error.dwsCode,category:error.dwsCategory,reason:error.dwsReason};}}
}
await writeFile('output/knowledge-diagnostics/whiteboard-parts-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

