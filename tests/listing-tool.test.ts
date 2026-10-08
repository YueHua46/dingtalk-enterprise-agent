import { readFile } from 'node:fs/promises';
import { describe,it,expect,vi } from 'vitest';
import { ListingTool, MemoryListingSessionStore, PgListingSessionStore, listingDynamicTools } from '../src/listing-tool.js';
import { MemoryListingRevisionStore } from '../src/listing-revision-store.js';
const product = await readFile(new URL('../examples/listing/camera-product.txt',import.meta.url),'utf8');
const fixture = JSON.parse(await readFile(new URL('../examples/listing/export-version-sample.json',import.meta.url),'utf8')).version;
const request: any = {requestId:'listing-test-session',messageId:'real-message',text:product,user:{corpId:'corp',userId:'user'},surface:{type:'group',id:'group'},attachments:[]};
it('preserves serialized session order through PostgreSQL and refuses unverifiable legacy snapshots',async()=>{
  const scope={requestId:request.requestId,owner:request.user,surface:request.surface};
  const session={prepared:fixture.context.prepared,context:fixture.context};
  let serialized:string|null=null;
  const query=vi.fn(async(sql:string,args:any[])=>{
    if(sql.startsWith('INSERT')){serialized=args[6];return {rows:[]};}
    return {rows:[{payload_text:serialized}]};
  });
  const store=new PgListingSessionStore({query} as any);
  await store.save(scope,session);
  expect(JSON.stringify(await store.get(scope))).toBe(JSON.stringify(session));
  expect(query.mock.calls[1]![1]).toEqual(['corp','user','group','group','listing-test-session']);
  serialized=null;await expect(store.get(scope)).rejects.toThrow('SNAPSHOT_UPGRADE_REQUIRED');
});
async function setup() {
  const model = {complete:vi.fn(async (r: any) => {
    const input = JSON.parse(r.data), draft = structuredClone(fixture.draft);
    const ids = new Map(fixture.context.book.facts.map((f: any) => [f.id,input.ownFacts.find((n: any) => n.attribute === f.attribute)?.id]));
    for (const field of [draft.title,...draft.bullets,draft.description]) for (const claim of field.claims) claim.factIds=claim.factIds.map((id: string)=>ids.get(id));
    for (const item of [...draft.changes,...draft.verificationItems]) item.factIds=item.factIds.map((id: string)=>ids.get(id));
    draft.searchTerms={text:'',keywordRefs:[],factIds:[]};
    return {text:JSON.stringify(draft),model:'mock',responseId:null};
  })};
  const amazon={execute:vi.fn(async()=>({status:'unavailable'}))};
  const sessions=new MemoryListingSessionStore(),revisions=new MemoryListingRevisionStore();
  const tool=await ListingTool.create(sessions,revisions,model,amazon);
  const ports={sources:vi.fn(async (r: any)=>({request:r,documentSnapshots:{},listingSnapshots:{}})),deliver:vi.fn(async(payload: any)=>({files:2,scope:payload.scope}))};
  const call=(op: string,args: unknown,req=request,signal?: AbortSignal)=>tool.execute(req,op,args,ports,signal);
  return {tool,model,amazon,sessions,revisions,ports,call};
}
describe('Listing host workflow',()=>{
  it('revises one bullet while discarding model changes to unrelated fields',async()=>{
    const {call,model}=await setup();const p=await call('prepare',{input:{mode:'create',keywords:['indoor security camera']}});await call('research',{sessionId:p.sessionId});
    const first=await call('generate',{sessionId:p.sessionId});const base=model.complete.getMockImplementation()!;
    model.complete.mockImplementation(async(r:any)=>{
      const response=await base(r);const draft=JSON.parse(response.text);
      draft.title={text:'Unrelated change',claims:[{text:'Unrelated change',start:0,end:16,factIds:draft.title.claims[0].factIds}]};
      const field=draft.bullets[4];field.text='Storage: '+field.text;for(const c of field.claims){c.start+=9;c.end+=9;}
      return {...response,text:JSON.stringify(draft)};
    });
    const result=await call('revise',{sessionId:p.sessionId,baseVersionId:first.version.id,instruction:'只改第五点',fields:['bullets.4']},{...request,requestId:'one-bullet'});
    expect(result.status).toBe('version_saved');expect(result.version.draft.title).toEqual(first.version.draft.title);
    expect(result.version.draft.bullets.slice(0,4)).toEqual(first.version.draft.bullets.slice(0,4));
    expect(result.version.draft.description).toEqual(first.version.draft.description);
    expect(result.version.draft.bullets[4].text).toMatch(/^Storage: /);
  });
  it('runs preparation, partial research, mock generation and checked original-surface export; resume does not generate again',async()=>{
    const {call,model,ports}=await setup();
    const p=await call('prepare',{input:{mode:'create',keywords:['indoor security camera']}});
    expect(p.facts.length).toBe(12);
    expect((await call('research',{sessionId:p.sessionId})).research.status).toBe('partial');
    const first=await call('generate',{sessionId:p.sessionId});expect(first.status).toBe('version_saved');
    expect(first.version).not.toHaveProperty('context');
    expect(first.version).not.toHaveProperty('generationReceipt');
    const resumed=await call('generate',{sessionId:p.sessionId});expect(resumed.version.id).toBe(first.version.id);expect(model.complete).toHaveBeenCalledTimes(1);
    const result=await call('export',{sessionId:p.sessionId});expect(result.delivery.scope.surface.id).toBe('group');
    expect(ports.deliver.mock.calls[0]![0].sections[0].rows.every((r: string[])=>r[4]==='')).toBe(true);
  });
  it('rejects identity overrides, fake conversation excerpts, foreign users and other conversations',async()=>{
    const {call}=await setup();
    await expect(call('prepare',{input:{mode:'create',keywords:['indoor security camera']},userId:'admin'})).rejects.toThrow();
    const bound=await call('prepare',{input:{mode:'create',materials:[{id:'x',kind:'conversation',reference:'fake',content:'invented'}]}},{...request,requestId:'bound'});
    expect(bound.facts.some((f: any)=>f.rawValue==='invented')).toBe(false);
    const p=await call('prepare',{input:{mode:'create',keywords:['indoor security camera']}});
    await expect(call('inspect',{sessionId:p.sessionId},{...request,user:{corpId:'corp',userId:'other'}})).rejects.toThrow('LISTING_SESSION_NOT_FOUND');
    await expect(call('inspect',{sessionId:p.sessionId},{...request,surface:{type:'direct',id:'other'}})).rejects.toThrow('LISTING_SESSION_NOT_FOUND');
  });
  it('inspects prepared-only state and refuses export or a frozen research replacement',async()=>{
    const {call}=await setup();const p=await call('prepare',{input:{mode:'create',keywords:['indoor security camera']}});
    expect((await call('inspect',{sessionId:p.sessionId})).prepared).toBeDefined();
    await expect(call('export',{sessionId:p.sessionId})).rejects.toThrow('LISTING_RESEARCH_REQUIRED');
    await call('research',{sessionId:p.sessionId});await call('generate',{sessionId:p.sessionId});
    await expect(call('research',{sessionId:p.sessionId})).rejects.toThrow('LISTING_RESEARCH_FROZEN');
  });
  it('cancelled requests do not research, generate or deliver',async()=>{
    const {call,model,amazon,ports}=await setup();const abort=new AbortController();abort.abort();
    await expect(call('prepare',{input:{mode:'create',keywords:['indoor security camera']}},request,abort.signal)).rejects.toThrow('LISTING_CANCELLED');
    expect(model.complete).not.toHaveBeenCalled();expect(amazon.execute).not.toHaveBeenCalled();expect(ports.deliver).not.toHaveBeenCalled();
  });
  it('a model-produced tool call is rejected and cannot execute an external action',async()=>{
    const {call,model,ports}=await setup();model.complete.mockResolvedValueOnce({text:'{"type":"function_call","name":"shell"}',model:'mock',responseId:null});
    const p=await call('prepare',{input:{mode:'create',keywords:['indoor security camera']}});await call('research',{sessionId:p.sessionId});
    expect((await call('generate',{sessionId:p.sessionId})).code).toBe('invalid_structure');expect(ports.deliver).not.toHaveBeenCalled();
  });
  it('exposes no identity, policies or validation bypass in tool arguments',()=>{
    expect(listingDynamicTools[0]!.tools.map(t=>t.name)).toEqual(['prepare','research','generate','inspect','revise','export']);
    expect(JSON.stringify(listingDynamicTools)).not.toContain('validationPolicy');
  });
  it('discards translated or invented extraction candidates and retains exact labelled source facts',async()=>{
    const {call}=await setup();
    const p=await call('prepare',{input:{mode:'create',materials:[{id:'user',kind:'conversation',reference:'ignored',content:'translated data'}],
      statements:[{attribute:'resolution',value:'8K',sourceId:'user',excerpt:'分辨率：2K'},{attribute:'brand',value:'unknown brand',sourceId:'user',excerpt:'not in source'}]}});
    expect(p.rejectedCandidates).toHaveLength(2);
    expect(p.facts.find((f: any)=>f.attribute==='resolution').rawValue).toBe('2K');
    expect(p.facts.some((f: any)=>f.rawValue.includes('unknown'))).toBe(false);
  });
  it('persists revisions across tool instances and rechecks changed document access before export',async()=>{
    const {call,tool,model,amazon,sessions,revisions,ports}=await setup();
    ports.sources.mockImplementation(async(r: any)=>({request:r,documentSnapshots:{product:product},listingSnapshots:{}}));
    const p=await call('prepare',{input:{mode:'create',keywords:['indoor security camera'],materials:[{id:'doc',kind:'document',reference:'product',content:product}]}});
    await call('research',{sessionId:p.sessionId});const first=await call('generate',{sessionId:p.sessionId});
    model.complete.mockImplementationOnce(async(r: any)=>{
      const draft=JSON.parse(r.data).revision.previousDraft;
      draft.title.text=draft.title.text.replace('Security ','');draft.title.claims[0].text=draft.title.text;draft.title.claims[0].end=draft.title.text.length;
      return {text:JSON.stringify(draft),model:'revision-mock',responseId:null};
    });
    const revised=await tool.execute({...request,requestId:'revision-message'},'revise',{sessionId:p.sessionId,baseVersionId:first.version.id,instruction:'缩短标题',fields:['title']},ports);
    expect(revised.version.ordinal).toBe(2);expect(revised.version.parentId).toBe(first.version.id);
    const fresh=await ListingTool.create(sessions,revisions,model,amazon);
    expect((await fresh.execute(request,'inspect',{sessionId:p.sessionId},ports)).version.id).toBe(revised.version.id);
    ports.sources.mockRejectedValueOnce(new Error('permission_denied'));
    await expect(fresh.execute(request,'export',{sessionId:p.sessionId},ports)).rejects.toThrow('permission_denied');
    expect(ports.deliver).not.toHaveBeenCalled();
  });
  it('ASIN-only facts remain page-unverified; page statements cannot supplement provided product facts',async()=>{
    const {sessions,revisions,model,ports}=await setup();
    const amazon={execute:vi.fn(async(operation: string)=>operation==='get_product_detail'?{tool:'amazon.get_product_detail',marketplace:'US',data:{asin:'B012345678',marketplace:'US',title:'OtherBrand Indoor Camera',brand:'OtherBrand',bullets:['Indoor use only']}}:{status:'unavailable'})};
    const tool=await ListingTool.create(sessions,revisions,model,amazon);
    const only=await tool.execute({...request,requestId:'asin-only',text:'优化美国站 B012345678，只按页面保守改写'},'prepare',{input:{mode:'optimize',asin:'B012345678'}},ports);
    expect(only.facts.some((f: any)=>f.attribute==='page_statement'&&f.trust==='page_unverified')).toBe(true);
    expect(only.status).toBe('ready_limited');
    const provided=await tool.execute({...request,requestId:'asin-with-own-facts'},'prepare',{input:{mode:'optimize',asin:'B012345678'}},ports);
    expect(provided.facts.some((f: any)=>f.attribute==='page_statement')).toBe(false);
    expect(provided.status).toBe('needs_clarification');
  });
});
