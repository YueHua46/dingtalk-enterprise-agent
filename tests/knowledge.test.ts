import { describe, expect, it,vi } from 'vitest';
import {KnowledgeSource,documentImageReferences} from '../src/knowledge-source.js';
import { KnowledgeModel } from '../src/knowledge-model.js';
import { credentialVault, parseCsv, parseJsonml, parseSheet, sanitizeKnowledge, knowledgeTokens,knowledgeParserVersion } from '../src/knowledge-parse.js';
import { DwsReadGate } from '../src/dws-read-gate.js';
import { KnowledgeSync, resourceFromNode, sourceMetadataHash, knowledgeErrorCode } from '../src/knowledge-sync.js';
import { findFactConflicts, KnowledgeTool } from '../src/knowledge-tool.js';
import { loadConfig } from '../src/config.js';
import { mapConcurrent } from '../src/knowledge-concurrency.js';
import { runKnowledgePipeline } from '../src/knowledge-pipeline.js';
import { knowledgeWorkerError } from '../src/knowledge-worker-errors.js';

it('preserves safe parser diagnoses and distinguishes sandbox timeout from IPC overflow',()=>{
  expect(knowledgeWorkerError({killed:true,signal:'SIGTERM'})).toBe('KNOWLEDGE_WORKER_PARSE_TIMEOUT');
  expect(knowledgeWorkerError({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'})).toBe('KNOWLEDGE_WORKER_OUTPUT_LIMIT');
  expect(knowledgeWorkerError({stderr:'KNOWLEDGE_OCR_TIMEOUT\n'})).toBe('KNOWLEDGE_OCR_TIMEOUT');
  expect(knowledgeWorkerError({stderr:'secret source text'})).toBe('KNOWLEDGE_BINARY_PARSE_FAILED');
});

const config=loadConfig({NODE_ENV:'test',DINGTALK_ROBOT_CODE:'test',FILE_WORKER_MODE:'off',EMBEDDING_BASE_URL:'https://example.org/v1',EMBEDDING_API_KEY:'test'});
it.each(['allowed','own_incomplete','denied','changed'])('ordinary shared discovery never downloads or exposes another employee index (%s)',async(outcome)=>{
 const user={corpId:'corp',userId:'second'},node={nodeId:'shared1234',name:'共享知识',extension:'adoc',type:'file'};
 const shared={...resourceFromNode(node,'workspace123','共享知识',null),status:'ready',activeVersion:'owner-version'};
 const chunk={text:'已识别图片答案',position:{block:'b'},method:'vision'},order:string[]=[];
 const reuse=vi.fn(async(u:any,_r:any,_v:any,hash:string)=>{order.push('reuse');expect(u).toEqual(user);if(hash!=='matching')throw Error('KNOWLEDGE_SHARED_SOURCE_CHANGED');return 'private-version';});
 const store={sharedIndexUsers:['owner'],sharedResource:async()=>shared,resource:async()=>outcome==='own_incomplete'?{...shared,status:'needs_review',activeVersion:'incomplete-version'}:undefined,discover:async(u:any)=>{expect(u).toEqual(user);order.push('register');},reuseVerifiedIndex:reuse,failure:async()=>{},updateMetadata:async()=>{},state:async()=>{},status:async()=>({}),
 candidates:async()=>[{node_id:node.nodeId,...chunk,version_id:'owner-version'}],pool:{query:async(sql:string)=>({rowCount:0,rows:sql.includes('SELECT source_hash')&&outcome==='own_incomplete'?[{source_hash:'matching',parser_version:knowledgeParserVersion}]:sql.includes('SELECT text,position')?[chunk]:sql.includes('SELECT quality')?[{quality:[]}]:[]})}};
 const read=vi.fn(async(u:any)=>{expect(u).toEqual(user);order.push('read');return {hash:outcome==='changed'?'changed':'matching',content:{chunks:[],facts:[],quality:['image_pending']}};});
 const enqueueResource=vi.fn(async()=>{order.push('queue');});
 const sync={allowed:()=>true,enqueue:async()=>{},enqueueResource,authorizationVerified:async()=>{},source:{supported:()=>true,metadata:async(u:any)=>{expect(u).toEqual(user);order.push('metadata');if(outcome==='denied')throw Error('forbidden');return node;},read}};
 const rerank=vi.fn(async()=>[{index:0,score:.9}]),model={embed:async()=>[Array(1024).fill(1)],rerank};
 const result=await new KnowledgeTool({...config,KNOWLEDGE_READY_ONLY:'true',RERANK_MODEL:'rerank'},store as any,sync as any,model as any).execute(user,'search',{query:'完全没有字面匹配的提问'});
 expect(result.hits).toEqual([]);expect(read).not.toHaveBeenCalled();expect(reuse).not.toHaveBeenCalled();expect(rerank).not.toHaveBeenCalled();expect(result.coverageGaps).toHaveLength(1);
 expect(enqueueResource).toHaveBeenCalledTimes(outcome==='denied'?0:1);
});
it('pilot mode rejects incomplete indexed resources before any source or model call',async()=>{
 const user={corpId:'corp',userId:'employee'},resource=resourceFromNode({nodeId:'abcdefgh123',name:'未完成',extension:'adoc'},'space123','未完成',null);
 const read=vi.fn(),embed=vi.fn();
 const store={resource:async()=>resource,failure:async()=>{},pool:{query:async()=>({rows:[],rowCount:0})}};
 const sync={allowed:()=>true,enqueue:async()=>{},source:{supported:()=>true,read}};
 await expect(new KnowledgeTool({...config,KNOWLEDGE_READY_ONLY:'true'},store as any,sync as any,{embed} as any).execute(user,'read',{ref:resource.nodeId})).rejects.toThrow('KNOWLEDGE_REFERENCE_NOT_COMPLETE');
 expect(read).not.toHaveBeenCalled();expect(embed).not.toHaveBeenCalled();
});
it('pilot mode does not start queues or mutate scheduling state',async()=>{
 const query=vi.fn(),user={corpId:'corp',userId:'employee'};
 const sync=new KnowledgeSync({...config,KNOWLEDGE_AUTO_SYNC:'false'},{pool:{query}} as any,{} as any,{} as any,{} as any);
 await sync.start();await sync.enqueue(user);await sync.enqueueResource(user,'abcdefgh123');await sync.authorizationVerified(user);
 expect(query).not.toHaveBeenCalled();
});
it('persists sheet submission failure before another run can resubmit',async()=>{
 let state:string|undefined;
 const query=async(sql:string)=>{
  if(sql.includes('pg_try'))return {rows:[{locked:true}]};
  if(sql.startsWith('SELECT state'))return {rows:state?[{state,job_id:null}]:[]};
  if(sql.startsWith('INSERT INTO knowledge_sheet_exports'))state='starting';
  if(sql.includes("state='failed'"))state='failed';
  return {rows:[]};
 };
 const pool={connect:async()=>({query,release:()=>{}})},user={corpId:'corp',userId:'employee'};
 const dws={runCommand:vi.fn(async(identity:unknown,args:string[],options:any)=>{
  expect(identity).toEqual(user);expect(args.slice(0,2)).toEqual(['sheet','+knowledge-export-submit']);
  throw new Error('fixture CLI terminal export failure');
 })};
 const source=new KnowledgeSource({...config,FILE_WORKER_URL:'http://unused-worker.example',FILE_WORKER_SECRET:'fixture-secret'},dws as any,{} as any,{pool} as any);
 const resource=resourceFromNode({nodeId:'sheet123456',name:'SOP',extension:'axls',type:'file'},'space123','SOP',null);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 try{
  await expect(source.read(user,resource,false)).rejects.toThrow('fixture CLI terminal export failure');
  expect(state).toBe('failed');
  await expect(source.read(user,resource,false)).rejects.toThrow('KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION');
  expect(dws.runCommand).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllGlobals();}
});
it('blocks a recorded failed sheet export at the source boundary before invoking DWS',async()=>{
 const query=async(sql:string)=>({rows:sql.includes('pg_try')?[{locked:true}]:sql.startsWith('SELECT state')?[{state:'failed',job_id:null}]:[]});
 const pool={connect:async()=>({query,release:()=>{}})},dws={runCommand:vi.fn()},model={recognize:vi.fn()};
 const source=new KnowledgeSource({...config,FILE_WORKER_URL:'http://unused-worker.example',FILE_WORKER_SECRET:'fixture-secret'},dws as any,model as any,{pool} as any);
 const resource=resourceFromNode({nodeId:'sheet123456',name:'SOP',extension:'axls',type:'file'},'space123','SOP',null);
 const http=vi.fn(async()=>Response.json({}));vi.stubGlobal('fetch',http);
 try{
  await expect(source.read({corpId:'corp',userId:'employee'},resource,false)).rejects.toThrow('KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION');
  expect(dws.runCommand).not.toHaveBeenCalled();expect(model.recognize).not.toHaveBeenCalled();
  expect(http.mock.calls.every(call=>(call as unknown as [string,RequestInit])[1]?.method==='DELETE')).toBe(true);
 }finally{vi.unstubAllGlobals();}
});
it('decodes imported SVG document bytes without fetching an address and retains its original block',async()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="red"/></svg>';
 const user={corpId:'corp',userId:'employee'},resource=resourceFromNode({nodeId:'document123',name:'imported',extension:'adoc',type:'file'},'space123','imported',null);
 const tree=['root',['img',{uuid:'imported123',src:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')}]];
 const source=new KnowledgeSource(config,{runCommand:async(u:unknown)=>{expect(u).toEqual(user);return {complete:true,content:{jsonml:tree}};}} as any,{recognize:async()=> 'verified imported drawing'} as any);
 const binary=vi.spyOn(source as any,'binary').mockResolvedValue({sheets:[],pages:[],images:[{hash:'a'.repeat(64),dataUrl:'data:image/jpeg;base64,dGVzdA==',position:{image:'inline-svg'}}],quality:[],sourceHash:'a'.repeat(64)});
 const read=await source.read(user,resource,true);
 expect(binary.mock.calls[0]?.[2]).toBe('svg');expect(binary.mock.calls[0]?.[3]).toBeUndefined();
 expect((binary.mock.calls[0]?.[6] as Buffer).toString()).toBe(svg);
 expect(read.content.assets?.[0]?.position.block).toBe('imported123');expect(read.content.assets?.[0]?.position.image).toMatch(/^inline-svg:[a-f0-9]{64}$/);
 expect(read.content.quality.some(q=>q.startsWith('image_pending:'))).toBe(false);
});
it.each(['','not-base64','YWJ='])('fails closed on malformed inline document payload %j',async(payload)=>{
 const resource=resourceFromNode({nodeId:'document123',name:'imported',extension:'adoc',type:'file'},'space123','imported',null),model={recognize:vi.fn()};
 const source=new KnowledgeSource(config,{runCommand:async()=>({complete:true,content:{jsonml:['root',['img',{src:'data:image/svg+xml;base64,'+payload}]]}})} as any,model as any);
 const binary=vi.spyOn(source as any,'binary');
 await expect(source.read({corpId:'corp',userId:'employee'},resource,true)).rejects.toThrow('KNOWLEDGE_INLINE_IMAGE_INVALID');
 expect(binary).not.toHaveBeenCalled();expect(model.recognize).not.toHaveBeenCalled();
});
it('uses native resource IDs for every image and preserves block positions without following URLs',async()=>{
 const tree=['root',['p',['img',{uuid:'block123',src:'https://untrusted.example/secret',extraData:{resourceId:'resource123'}}],['img',{uuid:'block456',extraData:{resourceId:'resource456'}}]]];
 expect(documentImageReferences(tree)).toEqual([{block:'block123',whiteboard:false,resourceId:'resource123'},{block:'block456',whiteboard:false,resourceId:'resource456'}]);
 const user={corpId:'corp',userId:'employee'},resource=resourceFromNode({nodeId:'document123',name:'images',extension:'adoc',type:'file'},'space123','images',null);
 const source=new KnowledgeSource(config,{runCommand:async(u:unknown)=>{expect(u).toEqual(user);return {complete:true,content:{jsonml:tree}};}} as any,{recognize:async()=> 'verified image'} as any);
 const binary=vi.spyOn(source as any,'binary').mockResolvedValue({sheets:[],pages:[],images:[{hash:'a'.repeat(64),dataUrl:'data:image/jpeg;base64,dGVzdA==',position:{image:'original'}}],quality:[],sourceHash:'a'.repeat(64)});
 const result=await source.read(user,resource,true);
 expect(binary).toHaveBeenCalledTimes(2);expect(binary.mock.calls[0]?.[3]).toEqual(['doc','+media-download','--node','document123','--resource-id','resource123']);
 expect(result.content.assets?.map(a=>a.position)).toEqual([{block:'block123',image:'resource123'},{block:'block456',image:'resource456'}]);
 expect(result.content.quality.some(q=>q.startsWith('image_pending'))).toBe(false);
});
it('rejects an unverifiable image before releasing partially processed images to the model',async()=>{
 const resource=resourceFromNode({nodeId:'document123',name:'images',extension:'adoc',type:'file'},'space123','images',null);
 const model={recognize:vi.fn()};
 const source=new KnowledgeSource(config,{runCommand:async()=>({complete:true,content:{jsonml:['root',['img',{uuid:'block123',extraData:{resourceId:'resource123'}}],['img',{uuid:'block456',src:'https://untrusted.example/image'}]]}})} as any,model as any);
 vi.spyOn(source as any,'binary').mockResolvedValue({sheets:[],pages:[],images:[{hash:'a'.repeat(64),dataUrl:'data:image/jpeg;base64,dGVzdA==',position:{image:'original'}}],quality:[],sourceHash:'a'.repeat(64)});
 await expect(source.read({corpId:'corp',userId:'employee'},resource,true)).rejects.toThrow('KNOWLEDGE_IMAGE_RESOURCE_UNVERIFIED');
 expect(model.recognize).not.toHaveBeenCalled();
});
it('locates recognition failure by image ordinal and digest without logging image or block content',async()=>{
 const resource=resourceFromNode({nodeId:'document123',name:'images',extension:'adoc',type:'file'},'space123','images',null);
 const source=new KnowledgeSource(config,{runCommand:async()=>({complete:true,content:{jsonml:['root',['img',{uuid:'private-block',extraData:{resourceId:'resource123'}}]]}})} as any,
   {recognize:async()=>{throw Object.assign(new Error('KNOWLEDGE_VISION_TIMEOUT'),{modelStage:'response_body',modelAttempt:1,modelElapsedMs:180000});}} as any);
 vi.spyOn(source as any,'binary').mockResolvedValue({sheets:[],pages:[],images:[{hash:'a'.repeat(64),dataUrl:'data:image/jpeg;base64,dGVzdA==',position:{image:'original'}}],quality:[],sourceHash:'a'.repeat(64)});
 const error=await source.read({corpId:'corp',userId:'employee'},resource,true).catch(e=>e);
 expect(error.sourceStage).toBe('image_recognition');expect(error.modelImageOrdinal).toBe(1);expect(error.modelImageHash).toBe('a'.repeat(64));
 expect(error.modelStage).toBe('response_body');expect(JSON.stringify(error)).not.toMatch(/private-block|data:image/);
});
it('retains whiteboard cards as image evidence gaps for verified document export',()=>{
 const parsed=parseJsonml(['root',['p',['card',{cardType:'hetu',uuid:'whiteboard123'}]]]);
 expect(parsed.quality).toContain('image_pending:whiteboard123');expect(parsed.chunks).toHaveLength(0);
});
it('keeps only bounded provider error identifiers and never retries a forbidden embedding',async()=>{
 const http=vi.fn(async()=>Response.json({code:'DataInspectionFailed',request_id:'fixture-request-123',message:'secret document text',authorization:'secret-key'},{status:403}));
 const model=new KnowledgeModel(config,http as typeof fetch);
 const error=await model.embed(['fixture']).catch(e=>e);
 expect(error.message).toBe('KNOWLEDGE_EMBEDDING_HTTP_403');expect(error.providerCode).toBe('DataInspectionFailed');
 expect(JSON.stringify(error)).not.toContain('secret');expect(http).toHaveBeenCalledTimes(1);
 const oversized=new KnowledgeModel(config,(async()=>new Response('x'.repeat(20_000),{status:403})) as typeof fetch);
 const failure=await oversized.embed(['fixture']).catch(e=>e);expect(failure.providerCode).toBeUndefined();
});
it.each([
 ['No available channels for secret group','no_available_channel'],
 ['insufficient_quota secret account','insufficient_quota'],
 ['server overloaded secret input','capacity_exceeded'],
 ['unknown secret upstream error',undefined]
])('classifies provider failures without preserving message text (%s)',async(message,failure)=>{
 const http=vi.fn(async()=>Response.json({error:{type:'new_api_error',message}},{status:503,headers:{'retry-after':'120','x-request-id':'fixture-request-123'}}));
 const error=await new KnowledgeModel(config,http as typeof fetch).embed(['fixture']).catch(e=>e);
 expect(error.providerFailure).toBe(failure);expect(error.providerType).toBe('new_api_error');expect(error.providerRequestId).toBe('fixture-request-123');
 expect(JSON.stringify(error)).not.toContain('secret');expect(http).toHaveBeenCalledTimes(1);
});
it('binds shortcut image checkpoints to the indexed entry while reading the target as the same employee',async()=>{
 const user={corpId:'corp',userId:'employee'},entry=resourceFromNode({nodeId:'shortcut123',name:'SOP',extension:'dlink',type:'file'},'space123','SOP',null);
 const cache=vi.fn(async(_u,_node,_digest,_model,recognize)=>recognize());
 const source=new KnowledgeSource(config,{runCommand:async(u:unknown,args:string[])=>{
   expect(u).toEqual(user);
   return args.includes('+fetch')?{complete:true,content:{jsonml:['root',['image',{uuid:'image1',extraData:{resourceId:'resource123'}}]]}}:
    {document:args.includes(entry.nodeId)?{linkSourceInfo:{nodeId:'target123',extension:'adoc'}}:{name:'target',extension:'adoc'}};
 }} as any,{recognize:async()=> 'source evidence'} as any,{recognizedImage:cache} as any);
 vi.spyOn(source as any,'binary').mockResolvedValue({sheets:[],pages:[],images:[{hash:'a'.repeat(64),dataUrl:'data:image/jpeg;base64,dGVzdA==',position:{page:1}}],quality:[],sourceHash:'a'.repeat(64)});
 const read=await source.read(user,entry,true);
 expect(read.target).toBe('target123');expect(cache.mock.calls[0]?.[1]).toBe(entry.nodeId);expect(read.content.quality.some(q=>q.startsWith('image_pending'))).toBe(false);
});
it('does not clear document image gaps when the export has no matching image evidence',async()=>{
 const resource=resourceFromNode({nodeId:'image-doc123',name:'SOP',extension:'adoc',type:'file'},'space123','SOP',null);
 const source=new KnowledgeSource(config,{runCommand:async()=>({complete:true,content:{jsonml:['root',['p','步骤'],['card',{uuid:'image1',cardType:'hetu'}]]}})} as any,{} as any);
 vi.spyOn(source as any,'binary').mockResolvedValue({sheets:[],pages:[],images:[],quality:[],sourceHash:'a'.repeat(64)});
 await expect(source.read({corpId:'corp',userId:'employee'},resource,true)).rejects.toThrow('KNOWLEDGE_DOCUMENT_IMAGES_UNVERIFIED');
});
it('starts images after their own text commit while other text is still processing',async()=>{
  const events:string[]=[];let release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  await runKnowledgePipeline([1,2],async(n)=>{
    if(n===2){events.push('text2_started');await wait;}
    events.push('text'+n+'_committed');return true;
  },async(n)=>{events.push('image'+n);if(n===1)release();},{textConcurrency:1,imageConcurrency:1});
  expect(events.indexOf('image1')).toBeGreaterThan(events.indexOf('text1_committed'));
  expect(events.indexOf('image1')).toBeLessThan(events.indexOf('text2_committed'));
  expect(events).toContain('image2');
});
it('does not enqueue failed text and drains running work after fatal pipeline errors',async()=>{
  const images:number[]=[];
  await runKnowledgePipeline([1,2],async(n)=>n!==1,async(n)=>{images.push(n);},{textConcurrency:2,imageConcurrency:2});
  expect(images).toEqual([2]);
  await expect(runKnowledgePipeline([1,2],async()=>{throw new Error('db_failed');},async()=>{},
    {textConcurrency:2,imageConcurrency:2})).rejects.toThrow('db_failed');
});
describe('knowledge model protocol',()=>{
  it.each([null,{output:{}},{output:[{content:{}}]},{output:[{content:[{text:42}]}]}])('rejects malformed vision body as a provider protocol error (%j)',async(body)=>{
    const model=new KnowledgeModel({...config,MODEL_BASE_URL:'https://vision-shape.example/v1',MODEL_API_KEY:'test'},(async()=>Response.json(body)) as typeof fetch);
    await expect(model.recognize('data:image/png;base64,dGVzdA==')).rejects.toThrow('KNOWLEDGE_VISION_RESPONSE_INVALID');
  });
  it('retries transient vision responses respecting Retry-After and bounds permanent failures',async()=>{
    let calls=0;const waits:number[]=[];
    const model=new KnowledgeModel({...config,MODEL_BASE_URL:'https://vision-retry.example/v1',MODEL_API_KEY:'test'},(async()=>{
      return ++calls===1?new Response('',{status:503,headers:{'retry-after':'2'}}):Response.json({output:[{content:[{text:'verified'}]}]});
    }) as typeof fetch,async(ms)=>{waits.push(ms);});
    expect(await model.recognize('data:image/png;base64,dGVzdA==')).toBe('verified');expect(calls).toBe(2);expect(waits).toEqual([2000]);
    calls=0;
    const permanent=new KnowledgeModel({...config,MODEL_BASE_URL:'https://vision-permanent.example/v1',MODEL_API_KEY:'test'},(async()=>{calls++;return new Response('',{status:403});}) as typeof fetch,async()=>{});
    await expect(permanent.recognize('data:image/png;base64,dGVzdA==')).rejects.toThrow('KNOWLEDGE_VISION_HTTP_403');expect(calls).toBe(1);
  });
  it('only retries the failed embedding batch and refuses to shorten a long server delay',async()=>{
    const batches:number[]=[];let calls=0;
    const model=new KnowledgeModel(config,(async(_url,init)=>{
      const input=JSON.parse(init!.body as string).input as string[];batches.push(input.length);
      if(++calls===2)return new Response('',{status:429,headers:{'retry-after':'0'}});
      return Response.json({data:input.map((_,index)=>({index,embedding:Array(1024).fill(1)}))});
    }) as typeof fetch,async()=>{});
    expect(await model.embed(Array(21).fill('fixture'))).toHaveLength(21);expect(batches).toEqual([20,1,1]);
    const limited=new KnowledgeModel(config,(async()=>new Response('',{status:429,headers:{'retry-after':'120'}})) as typeof fetch,async()=>{throw new Error('must not retry early');});
    await expect(limited.embed(['fixture'])).rejects.toThrow('KNOWLEDGE_EMBEDDING_HTTP_429');
  });
  it.each(['TimeoutError','AbortError'])('reports vision %s distinctly from DWS failure',async(kind)=>{
    const model=new KnowledgeModel({...config,MODEL_BASE_URL:'https://vision-timeout.example/v1',MODEL_API_KEY:'test'},(async()=>{throw new DOMException('fixture',kind);}) as typeof fetch);
    await expect(model.recognize('data:image/png;base64,dGVzdA==')).rejects.toThrow('KNOWLEDGE_VISION_TIMEOUT');
  });
  it.each(['response_headers','response_body'])('retains safe timeout stage %s without retrying or recording provider text',async(stage)=>{
    const abort=()=>{throw new DOMException('secret response text','AbortError');};
    const http=vi.fn(async()=>{
      if(stage==='response_headers')return abort();
      return {ok:true,json:async()=>abort()};
    });
    const model=new KnowledgeModel({...config,MODEL_BASE_URL:`https://vision-diagnostic-${stage}.example/v1`,MODEL_API_KEY:'test'},http as unknown as typeof fetch);
    const error=await model.recognize('data:image/png;base64,dGVzdA==').catch(e=>e);
    expect(error.message).toBe('KNOWLEDGE_VISION_TIMEOUT');expect(error.modelStage).toBe(stage);
    expect(error.modelElapsedMs).toBeGreaterThanOrEqual(0);expect(error.modelAttempt).toBe(1);
    expect(http).toHaveBeenCalledTimes(1);expect(JSON.stringify(error)).not.toContain('secret');
  });
  it.each([10,30,50])('shares a %s-call vision limit across document model instances',async(limit)=>{
    let active=0,maximum=0;
    const http=(async()=>{
      active++;maximum=Math.max(maximum,active);
      await new Promise(resolve=>setTimeout(resolve,5));active--;
      return Response.json({output:[{content:[{text:'识别结果'}]}]});
    }) as typeof fetch;
    const visionConfig={...config,MODEL_BASE_URL:`https://vision-limit-${limit}.example/v1`,MODEL_API_KEY:'test',KNOWLEDGE_VISION_CONCURRENCY:limit};
    const models=[new KnowledgeModel(visionConfig,http),new KnowledgeModel(visionConfig,http)];
    const results=await Promise.all(Array.from({length:limit+15},(_,i)=>models[i%2]!.recognize('data:image/png;base64,dGVzdA==')));
    expect(maximum).toBe(limit);expect(active).toBe(0);expect(results).toHaveLength(limit+15);
  });
  it('preserves image order and drains in-flight recognition before failing',async()=>{
    const ordered=await mapConcurrent([0,1,2],3,async(value)=>{await new Promise(r=>setTimeout(r,(3-value)*3));return value;});
    expect(ordered).toEqual([0,1,2]);
    let completed=false;
    await expect(mapConcurrent([0,1],2,async(value)=>{
      if(value===0)throw new Error('image_failed');
      await new Promise(r=>setTimeout(r,5));completed=true;return value;
    })).rejects.toThrow('image_failed');
    expect(completed).toBe(true);
  });
  it('reranks with the shared embedding host/key and validates original indices',async()=>{
    const model=new KnowledgeModel({...config,RERANK_MODEL:'qwen3.7-text-rerank'},(async(url,init)=>{
      expect(String(url)).toBe('https://example.org/api/v1/services/rerank/text-rerank/text-rerank');
      const body=JSON.parse(init!.body as string);expect(body.input.documents).toEqual(['first','second']);expect(body.parameters.top_n).toBe(2);
      return Response.json({output:{results:[{index:0,relevance_score:.1},{index:1,relevance_score:.9}]}});
    }) as typeof fetch);
    expect(await model.rerank('query',['first','second'])).toEqual([{index:1,score:.9},{index:0,score:.1}]);
  });
  it.each(['duplicate','missing','nan','outside'])('rejects invalid rerank %s results',async(kind)=>{
    const results=[{index:0,relevance_score:.5},{index:1,relevance_score:.8}];
    if(kind==='duplicate')results[1]!.index=0;
    if(kind==='missing')results.pop();
    if(kind==='nan')results[1]!.relevance_score=NaN;
    if(kind==='outside')results[1]!.relevance_score=2;
    const model=new KnowledgeModel({...config,RERANK_MODEL:'qwen3.7-text-rerank'},(async()=>Response.json({output:{results}})) as typeof fetch);
    await expect(model.rerank('q',['a','b'])).rejects.toThrow('KNOWLEDGE_RERANK');
  });
  it('splits 21 inputs, restores provider order, requests float 1024 vectors',async()=>{
    const sizes:number[]=[];
    const http=async (_url:unknown,init:any)=>{
      const body=JSON.parse(init.body);sizes.push(body.input.length);
      expect(body.dimensions).toBe(1024);expect(body.encoding_format).toBe('float');
      return Response.json({data:body.input.map((_:string,index:number)=>({index,embedding:Array(1024).fill(index+1)})).reverse()});
    };
    const vectors=await new KnowledgeModel(config,http as typeof fetch).embed(Array(21).fill('文档'));
    expect(sizes).toEqual([20,1]);expect(vectors[19]?.[0]).toBe(20);
  });
  it.each(['duplicate','dimension','count','zero'])('rejects corrupt %s vectors',async(kind)=>{
    const data=[0,1].map(index=>({index,embedding:Array(1024).fill(1)}));
    if(kind==='duplicate')data[1]!.index=0;
    if(kind==='dimension')data[0]!.embedding.pop();
    if(kind==='count')data.pop();
    if(kind==='zero')data[0]!.embedding.fill(0);
    const model=new KnowledgeModel(config,(async()=>Response.json({data})) as typeof fetch);
    await expect(model.embed(['a','b'])).rejects.toThrow('KNOWLEDGE_EMBEDDING');
  });
});
it.each([false,true])('never sends revoked cached candidates to rerank, including fallback (%s)',async(fail)=>{
  const user={corpId:'corp',userId:'employee'},node={nodeId:'allowed123',name:'当前说明',type:'file',extension:'adoc'};
  const resource={...resourceFromNode(node,'workspace123','当前说明',null),activeVersion:'version',status:'ready'};
  const chunk={text:'当前可读答案',position:{block:'b'},method:'jsonml'};
  const store={resource:async(_u:unknown,id:string)=>({...resource,nodeId:id}),failure:async()=>{},state:async()=>{},status:async()=>({}),
    candidates:async()=>[{node_id:'revoked123',text:'撤权缓存',version_id:'version',position:chunk.position},{node_id:node.nodeId,...chunk,version_id:'version'}],
    pool:{query:async(sql:string)=>({rows:sql.includes('SELECT source_hash')?[{source_hash:'hash',parser_version:knowledgeParserVersion,embedding_model:config.EMBEDDING_MODEL}]:sql.includes('SELECT text,position')?[chunk]:sql.includes('SELECT quality')?[{quality:[]}]:[]})}};
  const sync={allowed:()=>true,enqueue:async()=>{},authorizationVerified:async()=>{},source:{supported:()=>true,
    metadata:async(_u:unknown,id:string)=>{if(id==='revoked123')throw new Error('forbidden');return node;},
    read:async()=>({hash:'hash',content:{chunks:[chunk],facts:[],quality:[]}})}};
  let sent:string[]=[];
  const model={embed:async()=>[Array(1024).fill(1)],rerank:async(_q:string,documents:string[])=>{sent=documents;if(fail)throw new Error('KNOWLEDGE_RERANK_HTTP_503');return [{index:0,score:.9}];}};
  const result=await new KnowledgeTool({...config,RERANK_MODEL:'qwen3.7-text-rerank'},store as any,sync as any,model as any).execute(user,'search',{query:'答案'});
  expect(sent.join(' ')).not.toContain('撤权缓存');expect(sent.join(' ')).toContain('当前可读答案');
  expect(result.ranking.status).toBe(fail?'fallback':'passed');expect(result.hits).toHaveLength(1);expect(result.coverageGaps).toEqual([{ref:'revoked123',reason:'permission_denied'}]);
});
describe('structured document evidence',()=>{
  it('keeps first child without root attributes, tables and block positions',()=>{
    const parsed=parseJsonml(['root',['h1',{uuid:'title'},'准备条件'],['table',{uuid:'table'},['tr',['td','第一步'],['td','检查异常']]]]);
    expect(parsed.chunks.map(c=>c.text).join(' ')).toContain('准备条件');
    expect(parsed.chunks.find(c=>c.position.block==='table')?.text).toContain('检查异常');
  });
  it('does not confuse normal password instructions with vaults or real secrets',()=>{
    expect(credentialVault('各岗位SOP/修改密码说明')).toBe(false);
    expect(credentialVault('公司/API KEY')).toBe(true);
    expect(sanitizeKnowledge('点击修改密码，然后输入新密码')).toContain('点击修改密码');
    expect(sanitizeKnowledge('API_KEY=secret123 密码：abc123')).not.toContain('secret123');
  });
  it('parses quoted multiline CSV cells and true row markers',()=>{
    expect(parseCsv('[row=3] "a,b","line1\nline2"\n[row=8] c,d')).toEqual([['a,b','line1\nline2'],['c','d']]);
  });
  it('keeps units and horizontal models separate and excludes credential columns',()=>{
    const parsed=parseSheet([{row:2,cells:['型号','P31WJ55-2-FAS','','型号','P42WJ35-2-FAS']},
      {row:4,cells:['分辨率','2880*1620@15fps','','分辨率','2304*1296@15fps']},
      {row:5,cells:['供电','DC 5V1A','','供电','DC 12V']}],'J系列',true);
    expect(parsed.facts.find(f=>f.model==='p31wj55-2-fas'&&f.attribute==='供电')?.value).toBe('DC 5V1A');
    expect(parsed.facts.find(f=>f.model==='p42wj35-2-fas'&&f.attribute==='供电')?.position.range).toBe('D5:E5');
    const secret=parseSheet([{row:1,cells:['账号','密码']},{row:2,cells:['someone','raw-secret']}],'流程',false);
    expect(JSON.stringify(secret)).not.toContain('raw-secret');
  });
  it('uses Chinese bigrams and complete model tokens',()=>{
    expect(knowledgeTokens('摄像机 P31WJ55-2-FAS')).toContain('p31wj55-2-fas');
    expect(knowledgeTokens('摄像机')).toContain('摄像');
  });
  it('metadata hashes ignore request log IDs while tracking moves and modifications',()=>{
    const n={nodeId:'abcdefgh123',name:'SOP',type:'file',extension:'axls',updateTime:1};
    const r=resourceFromNode(n,'space123','岗位/SOP',null);
    expect(sourceMetadataHash({...n,logId:'random'},r)).toBe(r.metadataHash);
    expect(sourceMetadataHash({...n,updateTime:2},r)).not.toBe(r.metadataHash);
  });
  it('preserves conflicting standard values rather than picking one',()=>{
    expect(findFactConflicts([{model:'M',attribute:'电源',value:'5V'},{model:'M',attribute:'电源',value:'12V'}])).toHaveLength(1);
  });
  it.each(['download returned HTTP 403','permission denied opening output','remote artifact not found 404','unauthorized download response'])('does not treat CLI internal failure as a source access decision (%s)',(message)=>{
    expect(knowledgeErrorCode(Object.assign(new Error(message),{dwsCategory:'internal',dwsCode:'5'}))).toBe('KNOWLEDGE_DWS_INTERNAL_ERROR');
  });
  it('preserves explicit API permission decisions and classified export failure evidence',()=>{
    expect(knowledgeErrorCode(Object.assign(new Error('forbidden'),{dwsCategory:'api',dwsCode:'1'}))).toBe('permission_denied');
    expect(knowledgeErrorCode(Object.assign(new Error('download failed'),{dwsCategory:'api',dwsReason:'doc_export_download_failed',dwsCauseCode:'NoSuchKey'}))).toBe('KNOWLEDGE_DWS_EXPORT_OBJECT_MISSING');
  });
  it('does not classify network failures as permission denial',()=>{
    expect(knowledgeErrorCode(new Error('network timeout'))).toBe('source_read_failed');
    expect(knowledgeErrorCode(new Error('forbidden'))).toBe('permission_denied');
    expect(knowledgeErrorCode(new Error('KNOWLEDGE_VISION_HTTP_403'))).toBe('KNOWLEDGE_VISION_HTTP_403');
    expect(knowledgeErrorCode(new Error('DWS_COMMAND_TIMEOUT'))).toBe('KNOWLEDGE_DWS_TIMEOUT');
  });
});
it('DWS gate prioritizes foreground waiting calls',async()=>{
  const gate=new DwsReadGate(1),order:string[]=[];let release!:()=>void;
  const first=gate.run(()=>new Promise<void>(r=>{release=r;}));
  await Promise.resolve();
  const background=gate.run(async()=>{order.push('background');},true);
  const foreground=gate.run(async()=>{order.push('foreground');});
  release();await Promise.all([first,background,foreground]);expect(order).toEqual(['foreground','background']);
});
it('resumes paused synchronization only after verified authorization, scoped to the employee',async()=>{
  const queries:Array<{sql:string;args:unknown[]}>=[];
  const store={pool:{query:async(sql:string,args:unknown[])=>{queries.push({sql,args});return {rows:[]};}},enable:async()=>{}};
  const sync=new KnowledgeSync({...config,KNOWLEDGE_ENABLED:'true'},store as any,{} as any,{} as any,{} as any);
  const user={corpId:'corp',userId:'employee'};
  await sync.enqueue(user);
  expect(queries.some(q=>q.sql.includes('paused=false'))).toBe(false);
  await sync.authorizationVerified(user);
  const resume=queries.find(q=>q.sql.includes('paused=false'))!;
  expect(resume.args).toEqual(['corp','employee']);
  expect(resume.sql).toContain('paused AND enabled');
});
it.each([true,false])('traverses hasChildren files and only records absence after complete pages (%s)',async(complete)=>{
  const queries:string[]=[],nodes:string[]=[],folders:string[]=[];
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes('pg_try')?[{locked:true}]:sql.includes('RETURNING id')?[{id:'run'}]:[]};},release:()=>{}};
  const store={pool:{connect:async()=>client},discover:async(_u:unknown,r:any)=>{nodes.push(r.nodeId);return true;},state:async()=>{}};
  const source={supported:()=>false};
  const dws={runCommand:async(_u:unknown,args:string[])=>{
    if(args.includes('+space-list'))return {requestedType:'orgWikiSpace',autoPageComplete:true,spaces:[{workspaceId:'space123',name:'Wiki'}]};
    const index=args.indexOf('--folder'),folder=index<0?'root':args[index+1];folders.push(folder!);
    return {autoPageComplete:complete,nodes:folder==='root'?[{nodeId:'mind123456',name:'导图',type:'file',extension:'amind',hasChildren:true}]:[{nodeId:'doc1234567',name:'SOP',type:'file',extension:'adoc',hasChildren:false}]};
  }};
  const sync=new KnowledgeSync({...config,KNOWLEDGE_ENABLED:'true'},store as any,dws as any,source as any,{} as any);
  await sync.scan({corpId:'corp',userId:'user'});
  expect(nodes).toEqual(['mind123456','doc1234567']);expect(folders).toEqual(['root','mind123456']);
  expect(queries.some(sql=>sql.includes("status='directory_absent'"))).toBe(complete);
});
