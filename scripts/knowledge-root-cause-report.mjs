import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('output/knowledge-accuracy-2026-10-08');
async function phase(prefix,count){
 const runs=await Promise.all(Array.from({length:count},(_,i)=>readFile(join(root,`${prefix}-${i+1}/results.json`),'utf8').then(JSON.parse)));
 if(runs.some(r=>!r.finishedAt))throw new Error('E2E_PHASE_NOT_FINISHED');
 const results=runs.flatMap(r=>r.results);
 if(new Set(results.map(q=>q.id)).size!==results.length)throw new Error('DUPLICATE_QUESTION');
 return {runs,results};
}
const broad=await phase('root-regression',3),correction=await phase('root-final',3),ready=await phase('ready-final',3),context=await phase('context-final',3),reuse=await phase('reuse-final',1);
const before=JSON.parse(await readFile(join(root,'verified-results.json'),'utf8')).results;
const stats=results=>{const ms=results.map(q=>q.elapsedMs).sort((a,b)=>a-b);return {count:ms.length,completed:results.filter(q=>q.status==='completed').length,
 medianSeconds:(ms[Math.floor((ms.length-1)/2)]+ms[Math.ceil((ms.length-1)/2)])/2000,
 p95Seconds:ms[Math.ceil(ms.length*.95)-1]/1000,maxSeconds:ms.at(-1)/1000};};
const manualNotes={
 'faq-01':'首次新边界把泛称FAQ当成唯一文档导致未回答；修正为资料类型/资料实体区分，复测找回真实规定及两份出处。',
 'faq-02':'资料名称带空格时误绑定jennov FAQ；身份空白规范化及目录语义核对后回到产品FAQ。最后使用read.query定位，三个排查方向正确。',
 'faq-03':'旧边界错误绑定jennov FAQ，15次知识调用、164秒；修正后产品FAQ原值5m/15m/20m，27.5秒。',
 'sop-02':'业务对象james库存表曾被误当成知识文档身份；修正后在真实SOP中正确返回子表、空白筛选与SKU归属。',
 'parameter-02':'正确区分真实表格802.3at与规格书802.3af；最新真实答复79.1秒、3次知识调用、一次核验通过。模型本次没有再重复lookup，缓存机制另用真实DWS工具诊断校验，不能把单题加速全部归因于缓存。',
 'parameter-06':'完整规格书召回后应说明表格A95=15fps而规格书20fps；最新复测分别列出差异，54.8秒。规格书仅写标题没有对应点击链接，引用仍需改善；资料记载不同不等于已经证明历史版本/固件变化。',
 'variant-parameter':'不用fps原词，改问每秒画面数量；真实复测仍能分来源说明15/20fps差异。',
 'missing-03':'大回归143秒、21轮模型请求、8次RAG并转用多次原始DWS；统一查询路线和完整资料证据不足判定后45.5秒、1次RAG，明确无法确认列字母。',
 'variant-sop':'明确只查原SOP的另一种问法；判定缺图后阻止继续读，44.9秒，无K列确定结论。',
 'image-02':'原图60/45/30度正确，多轮复测只用原图，无另一图30/15度混入。',
 'variant-image':'毫米中文表达与明确原图限定，仍准确60/45/30度、真实原图引用。',
 'naming-01':'完整入库资料确有“3 0X 30倍变焦”；首次大回归误说没有此规则。保留全文证据并用资料内语义定位后正确回答30倍变焦，其余字符正确。',
 'manual-02':'大回归核心事实正确但漏出处链接；交付层对唯一真实来源补可点击引用，最终IP/状态/Continue/1分钟均正确。',
 'variant-page':'中文第二十一页提问；真实读取第21页，2MP/8MP与存储原理正确，原理说明与原文分开。'
};
const latest=new Map(broad.results.map(q=>[q.id,{phase:'root-regression',...q}]));
for(const q of correction.results)latest.set(q.id,{phase:'root-final',...q});
for(const q of ready.results)latest.set(q.id,{phase:'ready-final',...q});
for(const q of context.results)latest.set(q.id,{phase:'context-final',...q});
for(const q of reuse.results)latest.set(q.id,{phase:'reuse-final',...q});
const manual=[...latest.values()].map(q=>({id:q.id,phase:q.phase,core:'manually_reviewed',
 note:manualNotes[q.id]??'人工对照已读取原文基准，核心所问数值/步骤一致；自动词匹配只作辅助，不当成准确率。',
 elapsedMs:q.elapsedMs,knowledgeCalls:q.calls.length,review:q.verification?.filter(v=>v.event==='workflow.review')}));
await writeFile(join(root,'root-cause-manual-review.json'),JSON.stringify({method:'逐题人工对照真实原文；不同版本复测分别标注，不合成一个最终全量准确率',results:manual},null,2));
const summary={broad:stats(broad.results),correction:stats(correction.results),ready:stats(ready.results),context:stats(context.results),reuse:stats(reuse.results),priorReviewed:stats(before)};
await writeFile(join(root,'root-cause-e2e-results.json'),JSON.stringify({method:'Real model, employee DWS, index, application orchestration and production completion-review branches; local delivery/storage.',summary,
 broad:broad.results,correction:correction.results,ready:ready.results,context:context.results,reuse:reuse.results},null,2));
const lines=['# RAG 根因修复与真实 E2E 复测','',
 '方法：当前员工身份、真实 DWS 权限、真实入库资料、真实 embedding/rerank、模型自主选工具、实际任务编排及最终审核。本地捕获发送与任务存储，未验证生产钉钉收发、生产队列负载或文件 worker 执行。标准答案仅在测试后核验，不放入模型问题。三路独立应用进程。','',
 '## 已确认并修改的共性问题','',
 '1. **资料身份与回答内容混在一起。** 用户限定一张图，系统仍把同名图当补充；简写资料名称又可能从正文召回中选错文档。现在独立语义解释查询边界，从员工目录元数据确认资料身份，再以真实ref限制执行；资料类型、业务对象与指定知识文档分别理解。正常查询的normal/latest由用户语义意图确定，工具参数不能擅自扩大。没有添加用户问题关键词路由。','',
 '2. **参数表路径与原始资料路径割裂。** PDF规格书在索引中，不等于结构化参数查询会看到它。已删除WiFi/FPS等字段别名筛选，返回型号全部原字段，并主动语义召回相关原始资料。两种口径分来源说明，不把有限召回当全库无冲突。','',
 '召回使用整道原始问题，而不是模型临时选择的单个参数名；已核验短来源（每份不超过12000字符，最多2份合计24000字符）同时返回完整入库原文。无需额外源读取，避免一页规格书的供电等其他部分落在未召回的片段里。核验来源元数据只存一次，各片段用ref/version关联，减少重复出处挤掉正文。','',
 '同任务同型号只是换参数名时，完整字段与基于整道问题的原文证据相同；复用这份证据并重新核验当前权限/版本，不重复embedding/rerank。严格schema校验仍在复用之前进行。该复用路径另有真实DWS工具诊断，不拿它冒充自主回答E2E。','',
 '3. **位置不明时把自然语言当物理标识猜。** 新增read.query，在已确认资料内做语义定位；position只用于真实页码、单元格或工具返回的block标识，不能把标题当ID。命中保留原位置；没命中不表示全文不存在。','',
 '4. **核验没有看到主模型看到的完整证据。** 原始JSON前缀截断、均摊片段长度与只保留前40条，均可能隐藏规格书PoE或命名规则尾部30X，造成漏检或误否决。现在按实际序列化体积保留完整资料，预算不足明确标记截断与省略；知识单份40000字符，总核验160000字符，保留来源/版本/位置。短完整资料不再无故按条数切掉尾部。','',
 '5. **工具预算可绕过，缺答案仍继续找。** 缓存命中现在也计次数；知识查询共用工作时间预算。进入知识问答后不能转用动态DWS文档/表格/文件接口绕过范围、版本和预算。对于完整且有界的指定入库资料，独立语义判断是否足够回答；证据不足则明确说明并停止補查。该判断及最终核验都依据真实原文，没有预置本题答案。','',
 '6. **最后一轮审核失败却仍放行。** 轮数限制现在限制工作量，不能把被拒绝的知识答案变成确定事实；达到上限仍有阻断问题时返回无法可靠确认。唯一真实来源漏链接时可由宿主补引用，URL来自已核验来源，不生成链接。','',
 '## 测试批次与速度','',
 '|批次|题数|中位秒|P95秒|最长秒|','|---|---:|---:|---:|---:|',
 ...Object.entries(summary).map(([name,s])=>`|${name}|${s.count}|${s.medianSeconds.toFixed(1)}|${s.p95Seconds.toFixed(1)}|${s.maxSeconds.toFixed(1)}|`),'',
 'broad是22道原题加4道换问法的完整回归，发现新边界的误判与核验截断后又修正；correction为9道针对复测；ready为加入完整资料证据判断、资料内语义定位和引用修正后的6道复测；context为短来源完整上下文后的5道复测；reuse为型号证据复用后的1道自主回答复测。不同批次是不同代码阶段和样本，不能用其中位数直接声称整体提速，也不能把最新结果拼成一次最终版本26题全量运行。','',
 '|真实案例|本轮大回归秒|最新复测秒|效果|','|---|---:|---:|---|',
 ...['missing-03','faq-03','faq-02','naming-01','image-02','parameter-06','parameter-02'].map(id=>{const b=broad.results.find(q=>q.id===id),a=latest.get(id);return `|${id}|${(b.elapsedMs/1000).toFixed(1)}|${(a.elapsedMs/1000).toFixed(1)}|${manualNotes[id]}|`; }),'',
 '## 准确度与仍存在的限制','',
 '最新针对复测确认：指定图不混图；截图缺图不猜列字母；参数表和规格书的帧率/PoE差异分来源；泛称FAQ正常检索；业务对象不会误绑资料；中文页码与“每秒画面数量”换问法可回答。最终自动审核通过不等于全库100%准确，逐题人工记录另存 root-cause-manual-review.json。','',
 '速度没有全部达标：参数供电题先121秒，再94秒，最后79秒且一次核验通过；最后仍有3次知识调用、4轮主模型请求，单次主模型请求还出现27秒。这些请求均200、各1次，不是限流重试。单次对照不能证明全部耗时差异由代码造成。实际保留的模型请求累计只涵盖代理主模型；直接调用的语义解释/证据判断包含在知识工具时间里，核验另记，不能按互斥比例拆分。多来源引用仍有只列标题未提供对应点击链接的案例，不能声称交付质量已完全达标。','',
 '工作时间预算不是整个任务的硬超时，不能解决单次模型响应慢；原始资料语义召回仍有限，未检出冲突不等于全库无冲突。单份完整入库内容超过40000字符时不会据摘要判断缺失，仍走定位取证。目录身份核对有2000条上限，当前员工1062条在范围内，超限明确返回缺口。','',
 '未部署生产、未修改公司原文，未以单元测试代替真实请求。TypeScript构建成功。'
];
await writeFile(join(root,'root-cause-report.md'),lines.join('\n'));
console.log(JSON.stringify(summary));
