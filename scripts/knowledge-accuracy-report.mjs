import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('output/knowledge-accuracy-2026-10-08');
const read=async name=>JSON.parse(await readFile(join(root,name),'utf8'));
const baseline=await read('baseline-results.json');
const first=(await Promise.all(['after-1','after-2','after-3'].map(p=>read(p+'/results.json')))).flatMap(r=>r.results);
await writeFile(join(root,'after-results.json'),JSON.stringify({scope:baseline.scope,results:first},null,2));
const latest=(await Promise.all(['final-1','final-2','final-3'].map(async p=>{try{return await read(p+'/results.json');}catch{return {results:[]};}}))).flatMap(r=>r.results);
const metrics=rows=>{
 const values=rows.map(r=>r.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
 return {questions:rows.length,completed:rows.filter(r=>r.status==='completed').length,medianSeconds:((values[Math.floor((values.length-1)/2)]??0)+(values[Math.ceil((values.length-1)/2)]??0))/2000,p95Seconds:(values[Math.ceil(values.length*.95)-1]??0)/1000,maxSeconds:(values.at(-1)??0)/1000};
};
const issues={
 'parameter-04':'核心数值正确；第一轮答案把资料称为实测/标定，原文未证明此属性。',
 'naming-02':'核心解释正确；第一轮答案重复并夹入“准备给出回答”，输出质量不合格。',
 'image-02':'核心角度正确；第一轮仍补另一版图片，混入指定图片以外的信息。',
 'missing-03':'第一轮承认指定截图不可读，却用其他流程的K列作为确定结论；指定截图依据不足。',
 'parameter-06':'真实资料存在15fps与20fps冲突；第一轮已按来源分别说明，不能把冲突直接计作答错。'
};
const manual=first.map(r=>({id:r.id,coreQuestionSupported:r.id!=='missing-03',clickableKnowledgeCitation:/\]\(https:\/\/alidocs\.dingtalk\.com\//.test(r.answer??''),note:issues[r.id]??'已人工对照原文基准，核心所问事实一致；该记录不代表所有附加描述均已验证。'}));
await writeFile(join(root,'manual-review-first.json'),JSON.stringify({method:'人工对照已实际读取的原文及每题reference；词匹配仅辅助，不作为准确率',results:manual},null,2));
const stats={baseline:metrics(baseline.results),firstRepair:metrics(first),latestFocused:metrics(latest)};
await writeFile(join(root,'comparison.json'),JSON.stringify({statistics:stats,latest:latest.map(r=>({id:r.id,status:r.status,elapsedMs:r.elapsedMs,toolCalls:r.calls.length,contracts:r.modelRequests?.map(x=>x.knowledgeContract),answer:r.answer}))},null,2));
const lines=[
 '# RAG真实验收与根因记录',
 '',
 '测试使用当前员工DWS权限、实际索引、实际模型自主调用工具，走应用任务到答案链路。消息发送与持久化在本地捕获；不包含生产钉钉收发、队列与负载。未部署生产，未编辑公司源文档。',
 '',
 '2026-10-08后续审计纠正：本文件中的baseline、firstRepair、latestFocused历史脚本使用NODE_ENV=test，因此TaskOrchestrator.enforcing()为false，未覆盖生产模式交付前核验。真实检索链路仍成立，但不能称为完整交付验收。新的verified-*批次显式启用production/enforce分支，仍隔离本地存储与投递；逐题记录workflow.review审计证明核验实际执行。',
 '',
 '## 已确认的共用根因',
 '',
 '- 位置按序列化JSON字符串包含判断，混淆页码与坐标，并依赖属性写法。PDF第21页原本5段正确入库；旧请求返回86段，其中81段不在第21页。表格范围和局部位置JSON也实际复现无结果。修复为字段比较与范围相交，保留实际片段边界；不依赖某份文档或第21页。',
 '- search scope只识别空间ID，模型使用文档ref时找不到。统一支持空间或文档，保留员工身份限制。',
 '- 参数查询仅按字段文字包含匹配，WiFi与无线标准不一致；帧率还可能与分辨率存于同一字段。别名只扩展字段名；组合字段只有明确写了fps才返回，不推断缺失参数。',
 '- 搜索附整个目录历史错误，约十万字符多数不是题目证据。改用覆盖概况，完整诊断仍可通过status查询。',
 '- 模型适配层展开工具组时丢掉组级说明，来源边界和引用要求未到达模型。修复共用转换层，保留父级与操作说明；实际应用请求记录验证送达，不能仅凭说明送达就宣称模型必然遵守。',
 '',
 '## 实测与限制',
 '',
 '位置工具真实校验13项通过：5种页码写法、不存在页、旧完整位置、3种表格范围、2个WiFi别名、文档范围搜索。索引版本没有变化，不需要为本次位置修复重入库。详见position-live-results.json。',
 '',
 '|轮次|题数|完成|中位秒|P95秒|最长秒|',
 '|---|---:|---:|---:|---:|---:|',
 ...Object.entries(stats).map(([name,s])=>`|${name}|${s.questions}|${s.completed}|${s.medianSeconds.toFixed(1)}|${s.p95Seconds.toFixed(1)}|${s.maxSeconds.toFixed(1)}|`),
 '',
 '基线含串行13题、三路并发9题；第一轮修复三路并发22题；最新是追加修复后的重点题复测。运行方式不同且未重复统计，不能将总表当作严格性能基准或生产指标。',
 '',
 '第21页问题第一轮119.762秒→34.053秒，知识调用9次→2次。基线模型累计105.305秒、工具12.489秒，第一轮模型23.234秒；位置错误引发多轮尝试，但模型耗时仍是重要因素。其他题第一轮有退步，整体速度目标未达成。',
 '',
 '第一轮22题人工核验：核心所问事实21题有原文支持，missing-03指定截图结论依据不足；这不是全库准确率。图片混来源、输出重复、缺少可点击知识出处仍存在。完整记录见manual-review-first.json。',
 '',
 '## 最新重点复测',
 '',
 ...latest.map(r=>`- ${r.id}：${r.status}，${(r.elapsedMs/1000).toFixed(1)}秒，${r.calls.length}次知识调用；模型请求中来源边界与引用规则${r.modelRequests?.every(x=>x.knowledgeContract?.sourceBoundaryPreserved&&x.knowledgeContract?.citationGuidancePreserved)?'均保留':'需要进一步检查'}。`),
 '',
 '最新6题逐题阅读：PDF分辨率与存储/性能、英文手册激活复位、图片三个角度、图片未标25mm均与限定原文一致并提供知识链接；missing-03改为无法确认截图列字母，未再断言K列，但耗时151.084秒，8次知识调用、模型累计129.003秒。模型两次在未明确要求最新的题目中自行选择freshness=latest，现有说明约束不足；须在宿主绑定用户查询意图，不能把此规则遵守情况计作通过。',
 '',
 '帧率组合字段实际返回15fps与20fps，且答案有表格位置；但最新答案只表达参数表结果，未报告此前已检索证实的规格书20fps冲突。尚需解决跨格式事实覆盖与冲突检查，不能把结构化表格查到值当作所有来源已经核对。',
 '',
 '下一步以真实证据评估新规则是否阻止跨来源强断言、补齐引用，并定位剩余模型轮次和响应耗时。不使用数字替换、关键词拦截或为某个文档硬编码答案。'
 ];
await writeFile(join(root,'report.md'),lines.join('\n'));
console.log(JSON.stringify(stats));
