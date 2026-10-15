import { describe, expect, it, vi } from 'vitest';
import { LingxingScopedRead, LINGXING_SCOPED_READ_TOOLS, parseLingxingScopedRead, unwrapLingxingResult } from '../src/lingxing-scoped-read.js';
import { lingxingReadRegistry } from '../src/lingxing-read-registry.js';
import { capabilityCatalog } from '../src/capability-catalog.js';
import type { Config } from '../src/config.js';
const user = {corpId: 'corp-a', userId: 'user-a'};
const scope = {corp_id:'corp-a', dingtalk_user_id:'user-a', lingxing_sids:[240,242], store_ids:[1,2], stores:[{id:1,lingxing_sid:240},{id:2,lingxing_sid:242}],has_access:true};
const envelope = (data: unknown) => ({content:[{text:JSON.stringify({code:1,data:{code:1,data}})}]});
function setup(result: unknown = {list:[],total:0}) {
 const access={scopeFor:vi.fn().mockResolvedValue(structuredClone(scope))};
 const mcp={describe:vi.fn(async (toolId: string)=>({toolId,toolType:'read',inputSchema:lingxingReadRegistry[toolId]!.inputSchema})),execute:vi.fn(async ({toolId}:any)=>envelope(toolId==='ad_auth_shops'?[{sid:240,profile_id:'12345678901234'},{sid:242,profile_id:'22345678901234'},{sid:999,profile_id:'99945678901234'}]:toolId==='get_my_sids'?{list:[{id:240},{id:999}],total:2}:result))};
 return {access,mcp,t:new LingxingScopedRead({} as Config,access,mcp)};
}
describe('real scoped Lingxing business broker',()=>{
 it('makes business reads discoverable with the actual dispatch contract',()=>{
  const c=capabilityCatalog().find(x=>x.id==='lingxing.scoped.get_fba_stock_list');
  expect(c?.purpose).toContain('库存');expect(c?.inputShape).toContain('read_scoped');expect(c?.identity).toBe('scoped_service');
 });
 it('accepts ad store IDs in a separate namespace while still checking profiles',async()=>{
  const {t}=setup({data:[{store_id:2618728326,profile_id:'12345678901234'}],recordsFiltered:1});
  await expect(t.execute(user,{toolId:'ad_campaign_report',params:{store_sids:[240],report_date:'2026-10-08 - 2026-10-14',sort_field:'spends'}})).resolves.toMatchObject({source:'lingxing_mcp'});
 });
 it('registers broad store business reads and blocks writes and global tools',()=>{
  expect(LINGXING_SCOPED_READ_TOOLS.length).toBeGreaterThan(30);
  for(const toolId of ['advertising_sp_add_keywords','ad_campaign_tag_list','get_custom_report_by_id','query_fba_valid_list','__proto__'])expect(()=>parseLingxingScopedRead({toolId})).toThrow('NOT_REGISTERED');
 });
 it('refreshes identity scope and removes shared directory rows and counts',async()=>{
  const {t,access}=setup();const r:any=await t.execute(user,{toolId:'ad_auth_shops',params:{store_sids:[240]}});
  expect(access.scopeFor).toHaveBeenCalledWith(user,true);expect(r.data).toEqual([{sid:240,profile_id:'12345678901234'}]);expect(JSON.stringify(r)).not.toContain('99945678901234');
  const shops:any=await t.execute(user,{toolId:'get_my_sids'});expect(shops.data).toEqual([{id:240}]);
 });
 it('calls genuine report action, preserves every supported filter and injects mapped profiles',async()=>{
  const {t,mcp}=setup({list:[{profile_id:'12345678901234',budget:17}],total:48});
  const r:any=await t.execute(user,{toolId:'ad_campaign_report',params:{store_sids:[240],report_date:'2026-10-08 - 2026-10-14',state:'enabled',sort_field:'spends',page:2,length:10}});
  expect(mcp.execute).toHaveBeenLastCalledWith({toolId:'ad_campaign_report',params:expect.objectContaining({profile_ids:['12345678901234'],state:'enabled',page:2,length:10,sort_field:'spends'})});
  expect(r.data.total).toBe(48);expect(r.data.list[0].budget).toBe(17);expect(r.source).toBe('lingxing_mcp');expect(r.coverage.mode).toBe('upstream_response');
 });
 it.each([[],[999],['oops'],['240','oops'],[0],[null]])('rejects malformed or unauthorized scope %j',async(ids)=>{
  const {t,mcp}=setup();await expect(t.execute(user,{toolId:'erp_listing',params:{store_sids:ids}})).rejects.toThrow();expect(mcp.execute).not.toHaveBeenCalled();
 });
 it('blocks authorization failure, service failure and identity mismatch before MCP',async()=>{
  for(const bad of [{...scope,has_access:false},{...scope,lingxing_sids:[]},{...scope,corp_id:'other'}]){const {t,access,mcp}=setup();access.scopeFor.mockResolvedValue(bad);await expect(t.execute(user,{toolId:'get_my_sids'})).rejects.toThrow();expect(mcp.execute).not.toHaveBeenCalled();}
  const {t,access,mcp}=setup();access.scopeFor.mockRejectedValue(new Error('down'));await expect(t.execute(user,{toolId:'get_my_sids'})).rejects.toThrow('down');expect(mcp.execute).not.toHaveBeenCalled();
 });
 it('rejects a profile outside current SID subset, empty profiles, and conflicting main profile',async()=>{
  for(const extra of [{profile_ids:['99945678901234']},{profile_ids:[]},{profile_ids:['12345678901234'],profile_id:22345678901234}]){
   const {t,mcp}=setup();await expect(t.execute(user,{toolId:'ad_campaign_search_term_report',params:{store_sids:[240],report_date:'2026-10-08 - 2026-10-14',...extra}})).rejects.toThrow();expect(mcp.execute).toHaveBeenCalledTimes(1);
  }
 });
 it('rejects missing mapping rather than silently dropping requested stores',async()=>{
  const {t,mcp}=setup();mcp.execute.mockResolvedValue(envelope([{sid:240,profile_id:'12345678901234'}]));
  await expect(t.execute(user,{toolId:'ad_campaign_report',params:{report_date:'2026-10-08 - 2026-10-14',sort_field:'spends'}})).rejects.toThrow('MAPPING_MISSING');
 });
 it('requires single store for single-store endpoints and supports numeric/string IDs',async()=>{
  const {t,mcp}=setup();await expect(t.execute(user,{toolId:'customer_performance_notice_list'})).rejects.toThrow('SINGLE_STORE');
  await t.execute(user,{toolId:'customer_performance_notice_list',params:{sid:240}});expect(mcp.execute).toHaveBeenLastCalledWith({toolId:'customer_performance_notice_list',params:{sid:'240'}});
 });
 it('encodes each official scope format correctly',async()=>{
  const {t,mcp}=setup();await t.execute(user,{toolId:'customer_service_rma_list'});expect(mcp.execute).toHaveBeenLastCalledWith({toolId:'customer_service_rma_list',params:{sid:[240,242]}});
  await t.execute(user,{toolId:'get_fba_stock_list'});expect(mcp.execute).toHaveBeenLastCalledWith({toolId:'get_fba_stock_list',params:expect.objectContaining({sid:'240,242'})});
 });
 it('rejects unknown filters, missing required fields and invalid enums without business call',async()=>{
  for(const params of [{limit:10},{pvi_ids:''},{pvi_ids:'',length:'10'}]){
   const {t,mcp}=setup();const id='erp_listing';if(Object.hasOwn(params,'pvi_ids')&&Object.keys(params).length===1)continue;
   await expect(t.execute(user,{toolId:id,params})).rejects.toThrow();expect(mcp.execute).not.toHaveBeenCalled();
  }
  const {t,mcp}=setup();await expect(t.execute(user,{toolId:'platform_v2_page_list',params:{dataType:'invalid'}})).rejects.toThrow();expect(mcp.execute).not.toHaveBeenCalled();
 });
 it('blocks scope schema drift and tool becoming write',async()=>{
  for(const live of [{toolType:'write'},{toolType:'read',inputSchema:{properties:{sid:{type:'integer'}}}}]){const {t,mcp}=setup();mcp.describe.mockResolvedValue(live as any);await expect(t.execute(user,{toolId:'customer_performance_notice_list',params:{store_sids:[240]}})).rejects.toThrow();expect(mcp.execute).not.toHaveBeenCalled();}
 });
 it('rejects upstream scope leakage before returning data',async()=>{
  const {t}=setup({list:[{sid:999,orders:20}],total:1});await expect(t.execute(user,{toolId:'get_fba_stock_list',params:{store_sids:[240]}})).rejects.toThrow('SCOPE_VIOLATION');
 });
 it('preserves pagination outside the report rows',()=>{
   const r={content:[{text:JSON.stringify({code:1,data:{code:1,recordsFiltered:280,data:[{sid:240}],newStateList:['enabled']}})}]};
   expect(unwrapLingxingResult(r)).toMatchObject({recordsFiltered:280,data:[{sid:240}],newStateList:['enabled']});
 });
 it('rejects code zero even behind metadata and accepts code 200',()=>{
  expect(()=>unwrapLingxingResult(envelope({request_id:'r',code:1,data:{code:0,msg:'查询异常',data:[]}}))).toThrow('查询异常');
  expect(unwrapLingxingResult({content:[{text:JSON.stringify({code:200,msg:'OK',data:{records:[]}})}]})).toEqual({records:[]});
 });
 it('blocks storeId aliases returned outside the applied store scope',async()=>{
  const {t}=setup({records:[{storeId:999}]});
  await expect(t.execute(user,{toolId:'customer_voice_buyer_list',params:{store_sids:[240]}})).rejects.toThrow('SCOPE_VIOLATION');
 });
 it('checks revocation on the next business request',async()=>{
  const {t,access}=setup();await t.execute(user,{toolId:'get_my_sids'});
  access.scopeFor.mockResolvedValue({...scope,has_access:false});
  await expect(t.execute(user,{toolId:'get_my_sids'})).rejects.toThrow('ACCESS_DENIED');
 });
 it('requires ASIN or MSKU for keyword analysis',async()=>{
  const {t,mcp}=setup();await expect(t.execute(user,{toolId:'advertising_ad_analyze_keyword',params:{store_sids:[240],start_date:'2026-10-08',end_date:'2026-10-14',asin:[]}})).rejects.toThrow('asin 或 msku');
  expect(mcp.execute).not.toHaveBeenCalled();
 });
 it('surfaces nested business failures as failures',()=>{
  expect(()=>unwrapLingxingResult(envelope({code:403,msg:'forbidden',data:null}))).toThrow('BUSINESS_ERROR');
  expect(()=>unwrapLingxingResult({isError:true})).toThrow();
 });
});
