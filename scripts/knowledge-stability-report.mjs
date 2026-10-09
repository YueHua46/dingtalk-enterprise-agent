// Summarize saved real application runs; this does not grade by keyword match.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('output/knowledge-accuracy-2026-10-08');
const phases=[
 {name:'完整回归：出处身份校验',dirs:['stability-1','stability-2','stability-3']},
 {name:'多型号批量取证：重复比较',dirs:['stability-repeat-1']},
 {name:'目标证据优先：重复与错误前提',dirs:['stability-repeat-2','stability-repeat-3']},
 {name:'子集证据复用与明确纠错反馈',dirs:['stability-final-1']},
 {name:'附加解释的成立条件',dirs:['stability-inference-1']}
];
const all=[];const summaries=[];
for(const phase of phases){
 const results=[];
 for(const dir of phase.dirs){
  const run=JSON.parse(await readFile(join(root,dir,'results.json'),'utf8'));
  if(!run.finishedAt||run.results.some(r=>!r.status))throw new Error('RUN_NOT_FINISHED:'+dir);
  results.push(...run.results.map(r=>({...r,phase:phase.name,artifact:dir+'/results.json'})));
 }
 const seconds=results.map(r=>r.elapsedMs/1000).sort((a,b)=>a-b);
 const mid=Math.floor(seconds.length/2);
 const summary={phase:phase.name,count:results.length,completed:results.filter(r=>r.status==='completed').length,
  median:seconds.length%2?seconds[mid]:(seconds[mid-1]+seconds[mid])/2,
  p95:seconds[Math.ceil(seconds.length*.95)-1],max:seconds.at(-1),
  reviewed:results.filter(r=>r.verificationExecuted).length};
 summaries.push(summary);all.push(...results);
}
await writeFile(join(root,'stability-results.json'),JSON.stringify({method:'真实员工DWS、实际模型、真实应用交付核验；分阶段代码，不合并成最终版本准确率',phases:summaries,results:all},null,2));
const manual=all.map(r=>({phase:r.phase,id:r.id,question:r.question,reference:r.expected.reference,
 artifact:r.artifact,status:r.status,coreFacts:'逐题对照已保存原文核对',sourceIdentity:'核对实际资料链接及来源范围',
 notes:r.id==='variant-page'&&r.artifact.startsWith('stability-')&&!r.artifact.startsWith('stability-inference')
  ? '核心尺寸和存储/性能趋势正确；附加机制解释须限定成立条件，不能认为同一压缩标准必然产生更高实际码率。另做最后一阶段复测。'
  : r.artifact.startsWith('stability-inference')?'核心尺寸与所问存储影响正确；区分原文和推断并说明实际存储受多变量影响。automaticCheck因缺少“性能”一词未通过，但用户本题未问设备性能，不视为核心事实错误。'
  : r.id==='basic-02'?'核心答案正确；本阶段目标证据被背景挤掉造成核验补查，随后调整共用证据排序并两次E2E复测。'
  : r.expected.noAnswer?'确认未用相似资料补缺项；读取错误不当作原文件没有图片。'
  : ['parameter-02','parameter-06','variant-parameter','repeat-2-1','repeat-2-2'].includes(r.id)?'分来源保留参数表/规格书差异；不猜差异原因；核对双方点击链接。'
  : r.id.startsWith('repeat-')?'重复请求或错误前提控制：按原文回答，不附和错误前提。':'核心事实、对象和引用范围核对。'}));
await writeFile(join(root,'stability-manual-review.json'),JSON.stringify({method:'Agent逐题对照原始资料与完整答复，非 automaticCheck 词匹配评分；没有独立人工评审',cases:manual},null,2));
const row=s=>`|${s.phase}|${s.count}|${s.median.toFixed(1)}|${s.p95.toFixed(1)}|${s.max.toFixed(1)}|`;
const last=all.find(r=>r.artifact.startsWith('stability-inference'));
const report=`# RAG 真实稳定性复测

本轮共 ${all.length} 个真实应用请求，覆盖26道完整回归题、14次重复/换说法/错误前提测试、2道最后产品比较复测、1道解释条件复测。普通问题仍使用已入库版本。全部用当前员工身份核验DWS权限，实际模型自主选工具，保留交付前核验；未向模型提供标准答案。

这是本地真实应用E2E：接收请求→Agent→模型→RAG→员工DWS权限→索引/原文证据→交付核验。消息发送、本地任务存储与验收数据库隔离；不包含生产钉钉收发、生产排队和生产负载。没有部署生产或修改公司资料。

## 本轮确认并修复的共用问题

1. **证据传递挤掉目标段落。** 变焦题真实读取第29页4个片段，其中已有光学/数码变焦答案；同时附带172个背景片段。旧整理先放背景，并按元数据时间差重复保留同一内容，40,000字符预算挤掉专门读取的答案。真实核验要求补查，耗时153.0秒。现在先保留本次读取/排名命中/字段，再放背景，按资料身份、版本、位置、内容去重，明确记录省略。修复后同题两次63.1、47.5秒，正确且一次核验通过。捕获原始证据重放只作辅助定位，结论以这两次真实E2E为准。

2. **多资料引用不能只靠模型记名称或拼链接。** completion可选择实际使用的sourceRefs；程序只接受已取得正文的资料身份，从真实元数据生成链接，语义核验检查内容是否确实支持该归属。真实FAQ草稿把另一份FAQ的四芯提醒归给《产品FAQ》，被核验拦住并纠正。产品比较最后复测还发现模型把基础知识PDF的身份填作S20规格书，身份校验拦住；反馈明确列出错误身份及已有合法资料，模型修改后无需再查询。身份正确不等于事实正确，最后语义核验保留。

3. **多个产品分别取证，重复单查已取得字段。** lookup_product兼容单型号及最多5型号数组，实际模型已自主使用数组。每个型号字段、来源、缺口单独保留，原文检索共享；不是用字段别名或问题关键词筛答案。比较完成后单查其中一台，可复用同一原始问题中的完整字段，重新验证权限和版本，过滤出所问型号。真实工具诊断12.2→1.7秒；最后自主E2E也触发复用，第二次工具调用1.6秒。整题仍61.6秒，不能把工具提速当成整题倍率。

4. **标注推断仍须交代成立条件。** 完整回归中的存储解释，核心事实正确，但额外说明的条件不够严谨。已在共用答复要求与核验要求中区分原文趋势和有条件的额外解释，没有加产品或题目关键词规则。最后复测${(last.elapsedMs/1000).toFixed(1)}秒，完整答复保存于stability-inference-1/results.json。

## 准确性核对

逐题核对核心尺寸、频段、帧率、供电、型号规则、FAQ限制、流程步骤、图片线色/角度；目标事实符合已保存原始资料。缺尺寸、缺角度、截图无法确认列字母均没有用另一份资料补成确定结论。重复提问能纠正错误前提；参数表/规格书冲突按来源保留，不推断固件或历史变更。

这不是全库准确率：样本源于此前8类资料，本轮有重复题，版本分阶段变化，没有独立人工评审。自动关键词检查与自动核验通过不等于100%正确。完整回归中额外机制解释的条件问题单独记录，不能以核心事实正确掩盖。最后解释题自动词检查未通过：没提“性能”，但用户本题只问尺寸和存储，因此按原问题核对核心事实，不把词检查当成错误率。

## 速度：按阶段报告

|阶段|题数|中位秒|P95秒|最长秒|
|---|---:|---:|---:|---:|
${summaries.map(row).join('\n')}

不同阶段题目、代码不同，小样本P95只描述本次观测，不能宣称生产P95或全库提速。长尾仍存在：完整回归153秒，早期重复产品比较110.9/102.5秒，最后比较86.2秒。最后比较正确保留15/20fps冲突及双方链接，2次知识调用、一次语义核验；仍有多轮模型生成和一次身份纠正。为准确而保留核验，未降低模型档位或截掉矛盾来源。

## 下一步边界

目前测试支持这些问法和资料范围内的正确性，未覆盖全库、更长资料、多人生产负载、所有实时同步场景、用户澄清后任务恢复等情况。长尾模型响应和多轮决策还须按实际记录继续优化；不能用词匹配路由、减少必要证据或直接放行未经支持的答案换速度。没有单元测试替代本轮真实请求。TypeScript构建和差异格式检查通过。

原始请求/答案/工具与模型耗时：stability-results.json。逐题核对记录：stability-manual-review.json。
`;
await writeFile(join(root,'stability-report.md'),report);
console.log(JSON.stringify({count:all.length,phases:summaries}));
