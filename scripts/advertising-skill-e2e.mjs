import {loadConfig} from '../dist/config.js';
import {CodexClient} from '../dist/codex-client.js';
import {GuideTool} from '../dist/guide-tool.js';
import {CrossBorderOpsAccessClient} from '../dist/crossborderops-access-client.js';
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off'});
const [corpId,userId]=String(config.DWS_BOT_PROFILE||'').split(':');
if(!corpId||!userId)throw new Error('CURRENT_IDENTITY_REQUIRED');
const user={corpId,userId};
const guide=new GuideTool(config),client=new CodexClient(config),access=new CrossBorderOpsAccessClient(config);
const cases=[
 ['de-sample','德国稳定盈利，假设投放点击14，花费100 EUR，0订单。是否可以降价或判亏损？说明规则、限制和复查。',[/15/,/不.*调价|不调|禁止.*调价/]],
 ['de-cooldown','德国稳定盈利，投放点击30且符合降价条件，但24小时前刚调价，当前竞价1 EUR，运营想直接降30%。只解释现在是否可以调整、允许幅度与复查时间。',[/72/,/20/]],
 ['de-negatives','德国SP搜索词Überwachungskamera Set 点击20、核心相关词、加购率9%（报表定义已确认）、ACoS暂超标。另一个Ersatzteil点击5。SB/SBV是否给关键词否定？给保留/否定判断及证据，不执行。',[/保留|观察/,/6/,/SB/]],
 ['jp-launch','日本新品，第一个月，假设日均点击12、ACoS60%。能否按成熟期ACoS直接停掉？搜索词报告出现相关词是否等于自然收录？给新品重点与复盘。',[/20/,/收录/,/7|15/]],
 ['jp-mature','日本成熟期，假设CTR0.2%、CVR2%、ACoS45%、日均点击8。说明诊断优先级、健康阈值、预算S/A/B/C分层和7–15天复盘，指出阈值间隙。',[/P0/,/0.5|0\.5/,/未定义|间隙/]],
 ['us-profit','美国假设P=256.49美元，广告前贡献利润M=76.947美元，每单保留R=20美元，预期CVR=2.5%。给正确利润公式、目标CPA和CPC，并说明是计算假设；若成本未知如何处理？',[/56.95|56.947/,/1.42/,/未知/]],
 ['us-stages','美国256.49美元仅为假设，没有真实报表。请简明列出原文五阶段CTR/CVR/预算分配、0.7/1.0/1.2倍CPA止损与放量样本条件。清货价改为199.99美元且ACoS25%时CPA是多少？不要编造活动ID。',[/假设/,/50.00|50美元|50 美元/,/5.*10|5–10|5至10/]],
 ['live-scope','先读取广告分析Skill，再用crossborderops.scope验证我当前可见店铺数量。不要列店铺明细或编造利润，不做广告修改。',[/92/]]
];
const selected=process.env.E2E_ONLY?.split(',').filter(Boolean);
const runCases=selected?.length?cases.filter(([id])=>selected.includes(id)):cases;
let failed=0;
try{
for(const [id,question,checks] of runCases){
 const calls=[]; const thread=await client.startThread(user);
 try{
 const result=await client.turn(thread,`当前用户身份已由宿主绑定。已安装Skill索引：\n${await guide.index()}\n请按广告分析Skill回答下列问题，先读取主Skill、对应站点完整原文与规则冲突处理。情景数字是测试假设，不能作为账户事实。仅允许只读reference与crossborderops.scope；不要调用消息或写操作。回答控制在800字以内，直接给结论、规则依据和复查点。\n${question}`,undefined,async req=>{
  if(req.method!=='item/tool/call')return {decision:'cancel'};
  const {namespace,tool,arguments:args}=req.params; calls.push({namespace,tool,args:namespace==='reference'?args:undefined});
  if(namespace==='reference'&&tool==='read_guide'){const r=await guide.execute(args);return {contentItems:[{type:'inputText',text:r.text}],success:true};}
  if(namespace==='crossborderops'&&tool==='scope'){const s=await access.scopeFor(user);return {contentItems:[{type:'inputText',text:JSON.stringify({total:s.store_ids.length,hasAccess:s.has_access})}],success:true};}
  return {contentItems:[{type:'inputText',text:'READ_ONLY_E2E: capability unavailable in this test'}],success:false};
 });
 const read=calls.some(c=>c.namespace==='reference'&&c.args?.name==='amazon-advertising-ai-optimizer');
 const ok=read&&checks.every(r=>r.test(result.text)); if(!ok)failed++;
 console.log(JSON.stringify({id,ok,calls,answer:result.text}));
 }catch(e){failed++;console.log(JSON.stringify({id,ok:false,error:String(e)}));}
}
}finally{await client.stop();}
console.log(JSON.stringify({planned:runCases.length,failed})); if(failed)process.exitCode=1;
