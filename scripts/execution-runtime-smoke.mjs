// Run inside the gateway container; synthetic task only, no business reads or messages.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {loadConfig} from '../dist/config.js';
import {TaskOrchestrator} from '../dist/task-orchestrator.js';
import {TaskWorkflow} from '../dist/task-workflow.js';
import {InMemoryRepository} from '../dist/persistence.js';
import {describeEvidence} from '../dist/evidence-manifest.js';
import {tableAnalysisCode,tableAnalysisSchema} from '../dist/analysis-table.js';

const id=randomUUID(), base=process.env.FILE_WORKER_URL+'/tasks/'+id;
const headers={'x-file-worker-secret':process.env.FILE_WORKER_SECRET,'content-type':'application/json'};
async function api(path,method,body){
  const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(100000)});
  if(!response.ok)throw new Error(`worker ${response.status}: ${await response.text()}`);
  return response.json();
}
await api('','POST');
try {
  const raw={dataset:'synthetic',data:{rows:[{object:'A',spend:10,clicks:2},{object:'A',spend:20,clicks:10}],coverage:{has_more:false}}};
  await api('/evidence/source.json','PUT',raw);
  const source={file:'source.json',sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex')};
  const calculation=await api('/python','POST',{code:tableAnalysisCode(tableAnalysisSchema.parse({evidenceId:'source',group_by:['object'],sums:['spend','clicks'],ratios:[{name:'cpc',numerator:'spend',denominator:'clicks'}]}),source)});
  assert.equal(calculation.exitCode,0,calculation.stderr);
  const result=JSON.parse(calculation.stdout);
  assert.equal(result.data.rows[0].cpc,2.5);
  await api('/evidence/facts.json','PUT',result);
  const file={file:'facts.json',evidenceId:'facts',capabilityId:'analysis.table',arguments:'{}',kind:'calculation',
    sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex'),...describeEvidence(JSON.stringify(result))};
  const workflow=new TaskWorkflow({evidence:[],revision:0,evidenceFiles:[file]});
  const codex={usesWorker:()=>true,writeEvidence:(_task,name,content)=>api('/evidence/'+name,'PUT',JSON.parse(content)),runPython:(_task,code)=>api('/python','POST',{code}),renderReport:(_task,payload)=>api('/report-render','POST',payload),inspectOutput:(_task,path)=>api('/outputs/inspect','POST',{path})};
  const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off'});
  const host=new TaskOrchestrator(config,new InMemoryRepository(),codex,{},{});
  const task={id,request:{text:'synthetic test',requestId:id,user:{corpId:'synthetic',userId:'synthetic'},surface:{type:'group',id:'synthetic'}}};
  const response=await host.handleCodexRequest(task,'synthetic',{method:'item/tool/call',params:{namespace:'artifact',tool:'render_report',arguments:{
    template:'amazon-advertising',fact_bindings:[{id:'saved_spend',evidenceId:'facts',where:{object:'A'},field:'spend',decimals:2}],evidence_tables:[{title:'Saved facts',evidenceId:'facts',columns:[{field:'object',label:'Object'},{field:'spend',label:'Spend'},{field:'cpc',label:'CPC'}]}],
    report:{report_title:'Binding test',marketplace:'DE',analysis_period:'synthetic',store_name:'synthetic',executive_summary:'Synthetic spend {{fact:saved_spend}}',data_quality:{source:'synthetic'}}
  }}},workflow,new Map());
  assert.equal(response.success,true,JSON.stringify(response));
  const path=JSON.parse(response.contentItems[0].text).path;
  const inspected=await api('/outputs/inspect','POST',{path});
  for(const value of ['Saved facts','30','2.5']) assert.ok(inspected.reviewText.includes(value),value);
  console.log(JSON.stringify({ok:true,cpc:2.5,boundReport:true,pdfBytes:inspected.size}));
}finally{await api('','DELETE');}
