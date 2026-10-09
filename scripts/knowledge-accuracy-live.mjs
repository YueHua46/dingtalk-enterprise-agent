// Real employee DWS reads and the application's task/model/tool/answer path.
// Local message capture and acceptance PostgreSQL replace delivery and storage.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeSync,knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {KnowledgeTool} from '../dist/knowledge-tool.js';
import {sanitizeKnowledge} from '../dist/knowledge-parse.js';
import {CodexClient} from '../dist/codex-client.js';
import {InMemoryRepository} from '../dist/persistence.js';
import {TaskOrchestrator} from '../dist/task-orchestrator.js';
import {createServer} from '../dist/server.js';
import {adaptModelRequest} from '../dist/model-tool-proxy.js';
import Fastify from 'fastify';
import {Readable} from 'node:stream';

const profile=process.argv[2];
assert.match(profile??'',/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/,'EXPLICIT_EMPLOYEE_PROFILE_REQUIRED');
const [corpId,userId]=profile.split(':'),user={corpId,userId};
const output=resolve(process.env.RAG_ACCURACY_OUTPUT??'output/knowledge-accuracy-2026-10-08');
await mkdir(join(output,'originals'),{recursive:true});
await mkdir(join(output,'workspace'),{recursive:true});
// Keep the local app-server run isolated from desktop MCP configuration. The
// production client still discovers and disables inherited servers; this
// acceptance run needs a valid empty inventory so a broken desktop transport
// cannot mask RAG results.
const codexHome=join(output,'codex-home');
await mkdir(codexHome,{recursive:true});
await writeFile(join(codexHome,'config.toml'),'[mcp_servers]\n');
process.env.CODEX_HOME=codexHome;
// Exercise the same completion/verification branches as deployed execution.
// Keep delivery and database isolated; NODE_ENV alone does not select them.
const executionEnvironment=process.env.RAG_E2E_NODE_ENV??'production';
assert(['production','test'].includes(executionEnvironment),'E2E_ENVIRONMENT_INVALID');
const config=loadConfig({...process.env,NODE_ENV:executionEnvironment,FILE_WORKER_MODE:'off',LOG_LEVEL:'warn',
  KNOWLEDGE_ENABLED:'false',KNOWLEDGE_TEST_USERS:profile,KNOWLEDGE_AUTO_SYNC:'false',
  DWS_CONFIG_DIR:join(homedir(),'.dws'),CODEX_WORKDIR:join(output,'workspace'),SKILLS_DIR:resolve('skills'),
  FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',
  KNOWLEDGE_DIR:resolve('data/knowledge-acceptance')});
// Optional failure injection is labelled separately from real vendor errors.
// It changes only the first transport statuses, never source data, tool results,
// model choices or answers. All successful responses come from the real model.
const injectedStatuses=(process.env.RAG_E2E_TRANSIENT_STATUSES??'').split(',').filter(Boolean).map(Number);
assert(injectedStatuses.length<=5&&injectedStatuses.every(s=>[429,502,503,504].includes(s)),'E2E_FAULT_STATUS_INVALID');
let failureBridge;
const transportObservations=[];
if(injectedStatuses.length){
  const upstream=config.MODEL_BASE_URL.replace(/\/+$/,'')+'/responses';
  failureBridge=Fastify({logger:false,bodyLimit:8*1024*1024});
  failureBridge.post('/responses',async(request,reply)=>{
    const injected=injectedStatuses.shift();
    if(injected){transportObservations.push({injected:true,status:injected,retryAfterSeconds:1});
      return reply.code(injected).header('retry-after','1').send({error:{message:'E2E injected transient transport failure',type:'e2e_injected_failure'}});}
    const response=await fetch(upstream,{method:'POST',headers:{'content-type':'application/json',authorization:request.headers.authorization??''},
      body:JSON.stringify(request.body),signal:AbortSignal.timeout(180000)});
    transportObservations.push({injected:false,status:response.status});
    reply.code(response.status).header('content-type',response.headers.get('content-type')??'application/json');
    const wait=response.headers.get('retry-after');if(wait)reply.header('retry-after',wait);
    return response.body?reply.send(Readable.fromWeb(response.body)):reply.send();
  });
  await failureBridge.listen({host:'127.0.0.1',port:0});
  config.MODEL_BASE_URL='http://127.0.0.1:'+failureBridge.server.address().port;
}
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance',max:6});
const dws=new DwsBroker(config),model=new KnowledgeModel(config),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL,config.KNOWLEDGE_READY_ONLY==='true');
const source=new KnowledgeSource(config,dws,model,store),sync=new KnowledgeSync(config,store,dws,source,model);
const tool=new KnowledgeTool(config,store,sync,model);
let current;
const run=dws.runCommand.bind(dws);
dws.runCommand=async(identity,args,options)=>{
  assert.deepEqual(identity,user,'EMPLOYEE_IDENTITY_MISMATCH');
  const start=Date.now();
  try{return await run(identity,args,options);}
  finally{current?.dws.push({operation:args.slice(0,2).join(' '),elapsedMs:Date.now()-start});}
};
const execute=tool.execute.bind(tool);
tool.execute=async(identity,operation,input,context)=>{
  assert.equal(identity.corpId,corpId);assert.equal(identity.userId,userId);
  const call={operation,input,startedMs:Date.now()-current.startedMs};current?.calls.push(call);
  const start=Date.now();
  try{call.result=await execute(identity,operation,input,context);return call.result;}
  catch(error){call.error=knowledgeErrorCode(error);throw error;}
  finally{call.elapsedMs=Date.now()-start;}
};

let server,client,orchestrator;
const report={startedAt:new Date().toISOString(),scope:'real_DWS_current_employee_and_application_task_model_tools_answers_with_local_delivery_and_acceptance_index',
  model:config.MODEL_NAME,executionEnvironment,workflowMode:config.TASK_WORKFLOW_MODE,
  completionVerificationExpected:executionEnvironment==='production'&&config.TASK_WORKFLOW_MODE==='enforce',
  transientFaultInjection:transportObservations,
  readyOnly:config.KNOWLEDGE_READY_ONLY,queryBudgetMs:config.KNOWLEDGE_QUERY_BUDGET_MS,results:[]};
try{
  assert(await dws.status(user,{fresh:true}),'DWS_AUTH_REQUIRED');
  if(process.argv.includes('--sources')){
    const titles=['产品FAQ','产品型号命名规则','1.库存调整-每周一库存更新',
      'How to add battery camera to NVR.202507','产品基础知识入门','9芯尾线结构图','红外灯灯杯角度搭配镜头','各产品参数资料'];
    const rows=(await pool.query('SELECT node_id FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND title=ANY($3) ORDER BY title',[corpId,userId,titles])).rows;
    const originals=[];
    for(const row of rows){
      const resource=await store.resource(user,row.node_id),start=Date.now();
      const entry={node:row.node_id,title:resource.title,type:resource.extension,checkedAt:new Date().toISOString()};
      originals.push(entry);
      try{
        await source.metadata(user,row.node_id);
        if(resource.extension==='adoc'){
          const raw=await dws.runCommand(user,['doc','+fetch','--node',row.node_id,'--scope','full','--detail','full']);
          assert.equal(raw.complete,true);assert(raw.content?.jsonml);
          const jsonml=typeof raw.content.jsonml==='string'?JSON.parse(raw.content.jsonml):raw.content.jsonml;
          entry.original=JSON.parse(JSON.stringify(jsonml,(_key,value)=>typeof value==='string'?sanitizeKnowledge(value):value));
          const flatten=value=>Array.isArray(value)?value.slice(typeof value[1]==='object'&&!Array.isArray(value[1])?2:1).map(flatten).join('\n'):typeof value==='string'?value:'';
          entry.text=flatten(entry.original);
        }else if(resource.extension==='axls'){
          const list=await dws.runCommand(user,['sheet','+list-sheets','--node',row.node_id]);
          assert.equal(list.count,list.sheets?.length);entry.sheets=[];
          for(const sheet of list.sheets){
            const body=await dws.runCommand(user,['sheet','+read','--node',row.node_id,'--sheet-id',sheet.sheetId]);
            entry.sheets.push({sheet,body:JSON.parse(JSON.stringify(body,(_key,value)=>typeof value==='string'?sanitizeKnowledge(value):value))});
          }
        }else{
          entry.file=join(output,'originals',row.node_id+'.'+resource.extension);
          await dws.downloadDriveFile(user,row.node_id,join(output,'originals'),row.node_id+'.'+resource.extension);
          if(resource.extension==='pdf')entry.body=(await source.read(user,resource,false)).content;
        }
        entry.status='read';
      }catch(error){entry.status='failed';entry.error=knowledgeErrorCode(error);}
      entry.elapsedMs=Date.now()-start;
      await writeFile(join(output,'sources.json'),JSON.stringify(originals,null,2));
      console.log(JSON.stringify({stage:'source',title:entry.title,type:entry.type,status:entry.status,elapsedMs:entry.elapsedMs}));
    }
  }else{
    const suite=JSON.parse(await readFile(process.env.RAG_ACCURACY_SUITE??join(output,'questions.json'),'utf8'));
    const selected=process.env.RAG_ACCURACY_IDS?.split(',');
    client=new CodexClient(config);
    const turn=client.turn.bind(client);
    client.turn=(threadId,input,onEvent,onApproval,attachments)=>turn(threadId,input,onEvent,onApproval?async request=>{
      if(current&&request.method==='item/tool/call'&&request.params.namespace==='agent'&&request.params.tool==='workflow'){
        const args=request.params.arguments??{},mapping=args.completion?.factEvidence;
        // Observe types only. Do not save submission text, arguments or any
        // string values; this distinguishes schema errors from missing facts.
        const kind=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
        const observation={operation:args.operation,mappingKind:kind(mapping),
          entryShapes:mapping&&typeof mapping==='object'?Object.values(mapping).slice(0,20).map(value=>({kind:kind(value),
            ...(Array.isArray(value)?{length:value.length,itemKinds:[...new Set(value.map(kind))]}:{})})):[],
          elapsedMs:Date.now()-current.startedMs};
        (current.submissionShapes??=[]).push(observation);
      }
      return onApproval(request);
    }:onApproval,attachments);
    client.onEvent(event=>{
      if(!current)return;
      const params=event.params??{},item=params.item;
      if(['item/started','item/completed'].includes(event.method)&&item?.type==='agentMessage'){
        (current.answerEvents??=[]).push({event:event.method,itemId:item.id,phase:item.phase??null,
          textChars:typeof item.text==='string'?item.text.length:0,elapsedMs:Date.now()-current.startedMs});
      }
    });
    const repo=new InMemoryRepository();
    const sender={async send(surface,text,title){current?.messages.push({surface:surface.id,text,title,elapsedMs:Date.now()-current.startedMs});}};
    orchestrator=new TaskOrchestrator(config,repo,client,dws,sender,undefined,undefined,undefined,undefined,tool);
    server=await createServer(config,orchestrator);
    const modelRequests=new WeakMap();
    server.addHook('onRequest',async(request)=>{
      if(current&&request.url.startsWith('/internal/model/v1/responses')){
        const call={startedMs:Date.now()-current.startedMs};
        (current.modelRequests??=[]).push(call);modelRequests.set(request,call);
      }
    });
    server.addHook('onResponse',async(request,reply)=>{
      const call=modelRequests.get(request);
      if(call){call.elapsedMs=Date.now()-current.startedMs-call.startedMs;call.statusCode=reply.statusCode;
        call.upstreamAttempts=Number(reply.getHeader('x-model-request-attempts')??1);}
    });
    server.addHook('preHandler',async(request)=>{
      const call=modelRequests.get(request);
      if(!call)return;
      const adapted=adaptModelRequest(request.body).body;
      const knowledge=(adapted.tools??[]).filter(t=>t.name?.startsWith('knowledge__'));
      call.requestBytes=Buffer.byteLength(JSON.stringify(adapted));
      call.reasoningEffort=adapted.reasoning?.effort??'provider_default';
      call.knowledgeContract={tools:knowledge.length,
        sourceBoundaryPreserved:knowledge.length>0&&knowledge.every(t=>t.description?.includes('用户限定一份文档或图片')),
        citationGuidancePreserved:knowledge.length>0&&knowledge.every(t=>t.description?.includes('source.url'))};
    });
    await server.listen({host:'127.0.0.1',port:0});
    config.PORT=server.server.address().port;
    await client.start();
    for(const question of suite.filter(q=>!selected||selected.includes(q.id))){
      current={id:question.id,category:question.category,question:question.question,expected:question.expected,
        startedMs:Date.now(),calls:[],dws:[],messages:[]};
      report.results.push(current);
      const messageId=randomUUID(),surface={type:'direct',id:'accuracy-'+messageId};
      const response=await server.inject({method:'POST',url:'/internal/messages',headers:{'x-internal-token':config.INTERNAL_API_TOKEN??''},payload:{requestId:messageId,messageId,user,surface,
        text:question.question,attachments:[],receivedAt:Date.now()}});
      assert.equal(response.statusCode,202);
      current.taskId=response.json().taskId;
      console.log(JSON.stringify({stage:'question',id:question.id,question:question.question}));
      let lastStatus;
      while(Date.now()-current.startedMs<240000){
        const task=await repo.findTask(current.taskId);
        if(task.status!==lastStatus){lastStatus=task.status;console.log(JSON.stringify({stage:'task',id:question.id,status:task.status,elapsedMs:Date.now()-current.startedMs}));}
        if(['completed','failed','cancelled','waiting_clarification','waiting_confirmation','waiting_oauth'].includes(task.status)){
          current.status=task.status;current.answer=task.resultSummary??'';current.error=task.errorCode;break;
        }
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(!current.status){
        await orchestrator.handleControl({requestId:randomUUID(),messageId:randomUUID(),user,surface,text:'取消当前任务',attachments:[],receivedAt:Date.now()});
        current.status='test_timeout';
      }
      current.elapsedMs=Date.now()-current.startedMs;
      current.workflow=await repo.getWorkflow(current.taskId);
      // Audit categories contain bounded host metadata, never full requests,
      // business tool output or provider responses.
      current.verification=repo.audits.filter(e=>e.taskId===current.taskId&&[
        'workflow.review','workflow.complete_rejected','workflow.complete','workflow.review_unavailable',
        'workflow.review_budget_exhausted','model.retry_scheduled'
      ].includes(e.eventType)).map(e=>({event:e.eventType,...e.payload}));
      current.verificationExecuted=current.verification.some(e=>e.event==='workflow.review');
      current.toolTrace=repo.audits.filter(e=>e.taskId===current.taskId&&e.eventType==='tool.call_finished')
        .map(e=>({...e.payload}));
      const refs=current.calls.flatMap(c=>[c.result?.source,...(c.result?.hits??[]).map(h=>h.source),...(c.result?.facts??[]).map(f=>f.source)]).filter(Boolean);
      current.expectedSourceRetrieved=question.expected.nodes.some(node=>refs.some(ref=>ref.ref===node));
      current.expectedSourceCited=question.expected.nodes.some(node=>current.answer.includes(node));
      const normalize=text=>text.replace(/[\s*_`]/g,'').toLowerCase();
      current.requiredTerms=question.expected.terms.map(alternatives=>({alternatives,matched:alternatives.some(term=>normalize(current.answer).includes(normalize(term)))}));
      current.automaticCheck=current.status==='completed'&&current.requiredTerms.every(t=>t.matched)
        &&(question.expected.noAnswer||current.expectedSourceRetrieved&&current.expectedSourceCited);
      current.grading='automatic_checks_pending_manual_source_and_answer_review';
      delete current.startedMs;
      await writeFile(join(output,'results.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({stage:'result',id:question.id,status:current.status,elapsedMs:current.elapsedMs,
        toolCalls:current.calls.length,verificationExecuted:current.verificationExecuted,
        sourceFound:current.expectedSourceRetrieved,sourceCited:current.expectedSourceCited,automaticCheck:current.automaticCheck}));
      await pool.query('DELETE FROM knowledge_dependencies WHERE corp_id=$1 AND user_id=$2 AND surface_id=$3',[corpId,userId,surface.id]);
      current=undefined;
    }
  }
}finally{
  await orchestrator?.stop();await client?.stop();await server?.close();await failureBridge?.close();await pool.end();
  report.finishedAt=new Date().toISOString();
  if(report.results.length)await writeFile(join(output,'results.json'),JSON.stringify(report,null,2));
}
