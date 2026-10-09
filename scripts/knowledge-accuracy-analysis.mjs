import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('output/knowledge-accuracy-2026-10-08');
const folders=(process.env.RAG_ANALYSIS_FOLDERS??'round2-1,round2-2,round2-3').split(',');
const name=process.env.RAG_ANALYSIS_NAME??'round2';
const runs=await Promise.all(folders.map(async folder=>{try{return {folder,...JSON.parse(await readFile(join(root,folder,'results.json'),'utf8'))};}catch{return {folder,results:[]};}}));
const results=runs.flatMap(r=>r.results);
const first=JSON.parse(await readFile(join(root,'after-results.json'),'utf8')).results;
const suite=JSON.parse(await readFile(join(root,'questions.json'),'utf8'));
const stats=rows=>{
 const ms=rows.map(x=>x.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
 const median=(ms[Math.floor((ms.length-1)/2)]??0)+(ms[Math.ceil((ms.length-1)/2)]??0);
 return {count:rows.length,completed:rows.filter(x=>x.status==='completed').length,
  medianSeconds:median/2000,p95Seconds:(ms[Math.ceil(ms.length*.95)-1]??0)/1000,maxSeconds:(ms.at(-1)??0)/1000};
};
const rows=suite.map(q=>{
 const r=results.find(x=>x.id===q.id),prior=first.find(x=>x.id===q.id);
 if(!r)return {id:q.id,category:q.category,status:'not_finished'};
 const modelMs=(r.modelRequests??[]).reduce((n,c)=>n+(c.elapsedMs??0),0);
 const toolMs=r.calls.reduce((n,c)=>n+(c.elapsedMs??0),0);
 const reviews=r.verification?.filter(e=>e.event==='workflow.review')??[];
 return {id:r.id,category:r.category,status:r.status,elapsedMs:r.elapsedMs,priorElapsedMs:prior?.elapsedMs,
  knowledgeCalls:r.calls.length,modelRequests:r.modelRequests?.length,modelProxyMs:modelMs,knowledgeToolMs:toolMs,
  // Sums can overlap if the agent makes parallel calls; never subtract them
  // from wall time and label the remainder as a measured queue duration.
  verificationMs:reviews.reduce((n,e)=>n+(e.durationMs??0),0),verification:reviews,
  sourceRetrieved:r.expectedSourceRetrieved,clickableKnowledgeCitation:/\]\(https:\/\/alidocs\.dingtalk\.com\//.test(r.answer??''),
  latestCallsWithoutExplicitLatestInThisFixedSuite:r.calls.filter(c=>c.input?.freshness==='latest').length,
  failedModelRequests:r.modelRequests?.filter(x=>x.statusCode>=400).length??0,
  manualReview:'pending',answer:r.answer,reference:q.expected.reference};
});
const report={method:'same fixed questions, real employee permissions, real model/tool/application; manual review required',
 runs:runs.map(r=>({folder:r.folder,executionEnvironment:r.executionEnvironment??'test (historical harness)',workflowMode:r.workflowMode,
  verificationExpected:r.completionVerificationExpected??false,finished:!!r.finishedAt})),
 statistics:{priorUnreviewed:stats(first),current:stats(results)},results:rows};
await writeFile(join(root,name+'-analysis.json'),JSON.stringify(report,null,2));
const lines=[`# ${name} 逐题真实E2E记录`,'',
 '此文件包含完整成功与失败结果，不用词匹配结果替代人工准确度。历史test模式跳过交付核验；production分支仍使用本地数据库与捕获投递。',
 '', '|题目|状态|前轮秒|本轮秒|知识调用|模型请求|模型请求累计秒|核验秒|出处链接|自行实时读取次数|',
 '|---|---|---:|---:|---:|---:|---:|---:|---|---:|',
 ...rows.map(r=>`|${r.id}|${r.status}|${((r.priorElapsedMs??0)/1000).toFixed(1)}|${((r.elapsedMs??0)/1000).toFixed(1)}|${r.knowledgeCalls??''}|${r.modelRequests??''}|${((r.modelProxyMs??0)/1000).toFixed(1)}|${((r.verificationMs??0)/1000).toFixed(1)}|${r.clickableKnowledgeCitation?'有':'待核实/缺少'}|${r.latestCallsWithoutExplicitLatestInThisFixedSuite??''}|`),
 '', '模型请求累计时间不包含直接调用的交付核验模型；模型、工具调用可能并行，累计值不可直接当作互斥时间比例。尚未结束的题目不计入完成率、不能宣称全套通过。',
 '', ...rows.filter(r=>r.answer).flatMap(r=>[`## ${r.id}`,'',`原文基准：${r.reference}`,'',r.answer,''])];
await writeFile(join(root,name+'-answers.md'),lines.join('\n'));
console.log(JSON.stringify({name,runs:report.runs,statistics:report.statistics}));
