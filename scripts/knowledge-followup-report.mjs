import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('output/knowledge-accuracy-2026-10-08');
const read=async name=>JSON.parse(await readFile(join(root,name),'utf8'));
const folders=['verified-1','verified-2','verified-3'];
const runs=await Promise.all(folders.map(p=>read(p+'/results.json')));
if(runs.some(r=>!r.finishedAt))throw new Error('FULL_RUN_NOT_FINISHED');
const results=runs.flatMap(r=>r.results);
if(results.length!==22||new Set(results.map(r=>r.id)).size!==22)throw new Error('SUITE_NOT_COMPLETE');
await writeFile(join(root,'verified-results.json'),JSON.stringify({scope:runs[0].scope,executionEnvironment:'production',results},null,2));
const reviews=results.flatMap(r=>r.verification.filter(e=>e.event==='workflow.review'));
const sorted=values=>values.sort((a,b)=>a-b);
const median=values=>{const v=sorted(values);return (v[Math.floor((v.length-1)/2)]+v[Math.ceil((v.length-1)/2)])/2;};
const invalid=results.filter(r=>r.verification.some(e=>e.reason?.startsWith('WORKFLOW_EVIDENCE_INVALID')));
const retry=await read('retry-and-submission-after/results.json');
const exhaustion=await read('retry-exhaustion/results.json');
const diagnosis=await read('submission-diagnostic/results.json');
const round2=await read('round2-analysis.json'),verified=await read('verified-analysis.json');
const notes={
 'parameter-02':{conflictCoverage:'supported_in_this_run',note:'本轮额外读取真实规格书并区分POE 802.3at/802.3af冲突；其他轮只查表格时漏掉该冲突。'},
 'parameter-06':{conflictCoverage:'incomplete',note:'表格15/20fps正确，已知规格书20fps没有进本题证据，因此核验也未报告它；不能声称跨来源参数已完整核对。'},
 'image-02':{sourceBoundary:'incomplete',note:'核心60/45/30度正确，仍补另一图片12mm的30/15度。交付核验pass并没有稳定遵守指定图片范围。'},
 'missing-03':{core:'evidence_insufficient',sourceBoundary:'unverified_relation',note:'已说明当前读取#NAME?，又确定回答K列；K在另一个流程有证据，但未验证另一个流程表头就是指定截图/目标表格的同一版本。不能叫凭空造K，也不能认定已确认本题列字母。'},
 'faq-01':{note:'核心规定一致；八芯不要四芯有本次检索其他FAQ依据，额外规则的引用仍应更明确。'}
};
const manual=results.map(r=>({id:r.id,core:'supported',clickableKnowledgeCitation:/\]\(https:\/\/alidocs\.dingtalk\.com\//.test(r.answer),
 note:'人工逐题对照已实际取得的原文基准，核心所问数值/规则一致。',...notes[r.id]}));
await writeFile(join(root,'manual-review-verified.json'),JSON.stringify({method:'人工核验与自动核验分别记录；缺口不是已证实数值错误，也不把pass当全库准确率。',results:manual},null,2));
const line=(label,s)=>`|${label}|${s.count}|${s.medianSeconds.toFixed(1)}|${s.p95Seconds.toFixed(1)}|${s.maxSeconds.toFixed(1)}|`;
const lines=[
 '# 真实E2E后续分析与重试复验', '',
 '本轮在当前员工DWS身份下完成两套各22题，覆盖8类资料/问题；三路独立应用进程并发，所有成功答案由真实模型自主调用真实知识工具生成。原文标准答案仅用于事后核验，没有注入模型。', '',
 '第一套round2继承历史test模式；第二套verified显式启用production/enforce分支并实际执行交付前核验。production在这里只控制代码分支，数据库仍为验收15432，消息仍本地捕获；未部署生产，未覆盖生产钉钉收发、队列、负载与文件任务worker路径。', '',
 '## 速度', '',
 '|批次|题数|中位秒|P95秒|最长秒|','|---|---:|---:|---:|---:|',
 line('上一轮完整22题（无交付核验）',round2.statistics.priorUnreviewed),
 line('当前完整22题（无交付核验）',round2.statistics.current),
 line('当前完整22题（含交付核验）',verified.statistics.current), '',
 '两套本轮题都完成22/22，题目和模型相同，但模型选择的工具和上游状态有波动，不是严格延迟因果试验。不能由单次差值推断生产性能提升。', '',
 `完整交付核验实际执行${results.filter(r=>r.verificationExecuted).length}/22，自动结果pass为${reviews.filter(r=>r.status==='pass').length}/22。核验模型调用的中位耗时${(median(reviews.map(r=>r.durationMs))/1000).toFixed(2)}秒；自动pass不是人工准确率。`, '',
 '慢的原因已分开：', '',
 '- 上游故障：round2 faq-01首个模型请求70339ms后502，之后重新请求成功，总141142ms。故障发生在网关到模型的请求，尚不能确定是网络哪一段或供应商内部哪一环。',
 '- 多轮查询：截图缺失题历史151084ms/8次知识调用，round2为124994ms/8次，verified为83200ms/6次；缺口已读到，仍尝试其他位置/来源。历史与round2还自行设置latest，用户未明确要求最新。verified这次没有latest，不代表已在宿主强制保证。',
 '- 提交格式返工：verified中14题出现WORKFLOW_EVIDENCE_INVALID，共17次。单独真实复现发现factEvidence映射值是单个字符串，接口原来只接受字符串数组。诊断parameter-02总75000ms、4次知识调用，先有证据后因引用格式被拒绝又读取资料。',
 '- 模型生成/协议轮次：verified basic-02仅2次知识调用，仍总102370ms，其中模型代理请求累计86194ms、核验5606ms。不能把这类时间全部算给向量检索。', '',
 '## 准确度与来源范围', '',
 '22题均检索到预期来源且答案有可点击知识链接。人工检查核心参数/操作步骤大多数与原文一致；不发布“全库准确率”或“22题自动pass所以全部准确”。', '',
 '- PDF第21页：页码误匹配已消除；本轮2MP/8MP分辨率和存储/性能要求正确，引用第21页。',
 '- 图片角度：核心数值正确，但仍补另一张同名资料。这是范围不稳定，单改提示没有彻底解决。',
 '- 截图列字母：K列在另一流程有真实依据，但指定截图未读出，两个来源之间的对应关系没有证实。核验仍pass，不能据此宣布答案可靠。',
 '- 产品参数冲突：帧率题仍只按参数表15/20fps回答；本轮另一产品题检索到POE at/af冲突并明确分别引用。说明是否报告冲突目前依赖模型是否额外搜索，没有稳定的跨格式冲突发现流程。', '',
 '## 本轮已修复并复验', '',
 '1. 证据引用支持单个或多个编号，入口统一成数组；保留成功证据ID、来源、分页等校验和最终答案核验。不是把任意引用或未知来源当成事实。',
 '2. 主模型HTTP重试集中到网关，默认最多6次尝试（首次+5次重试），120秒为失败尝试及等待的预算；这是单次模型请求的重试预算，不是整道题时限。成功流仍遵循原请求时限。429/502/503/504、短暂连接错误可以重试；400/401/403不盲试，Retry-After不能被更早的等待替换。',
 '3. 关闭代理路径客户端的HTTP/流重试及宿主整回合重复，防止次数层层相乘。已转发的SSE片段不会在网关重放，业务工具操作不从头执行。核验模型使用相同HTTP重试方法和共享90秒/尝试预算。', '',
 '客户端重试配置键根据本地启动代码并核对[官方配置说明](https://developers.openai.com/codex/config-reference)；统一入口使实际尝试数可记录。', '',
 '复验使用真实应用、模型和DWS；传输错误是本地显式注入，成功响应仍来自真实模型，不把注入429当作供应商真实限流：', '',
 `- 成功恢复：注入429→502后，第三次请求真实模型200。parameter-02完成${(retry.results[0].elapsedMs/1000).toFixed(2)}秒，1次知识调用；真实提交仍是单个证据字符串，已通过格式处理和最终核验，无格式拒绝。`,
 `- 另一参数题：${(retry.results[1].elapsedMs/1000).toFixed(2)}秒，3次知识调用，单个字符串引用同样接受并经过核验；相较诊断轮${(diagnosis.results[1].elapsedMs/1000).toFixed(2)}秒并未加速，因此只确认消除了格式拒绝，不宣称所有题变快。`,
 `- 上限：单独配置3次尝试，连续注入429/503/502后任务failed，实际只请求3次，0次知识调用。用该用例证明停止与防重试叠加，不将它计入RAG准确率。`, '',
 '新引用格式与重试修改只做了关键题真实复验，未在修改后重跑全22题。npm run build通过。', '',
 '## 接下来从共用流程解决', '',
 '优先把普通/实时查询意图、指定资料范围和任务查询进度绑定到宿主，不能让每个工具调用自行改变它们；缺失证据与未完成检索应明确区分。单个工具60秒预算现在会在每次调用重置，不限制整道题的反复尝试。', '',
 '对型号建立跨文档的证据关联，表格与规格书同时参与冲突检查；不能只给一个额外关键词让模型自行试找，也不能以来源标题猜权威。无法确认同一型号/版本/条件时保留差异和缺口。', '',
 '交付核验只看到已检索的证据，无法凭空发现未召回的规格书；应检查指定来源与结论之间的可验证关系。截图看不清时，其他流程可作为参考，但不能未经关系核验就冒充本截图的列字母。', '',
 '证据文件：verified-results.json、manual-review-verified.json、round2-analysis.json、submission-diagnostic/results.json、retry-and-submission-after/results.json、retry-exhaustion/results.json。'
];
await writeFile(join(root,'e2e-followup-report.md'),lines.join('\n'));
console.log(JSON.stringify({questions:results.length,verified:results.filter(r=>r.verificationExecuted).length,formatRejectedTasks:invalid.length,
  reviewMedianMs:median(reviews.map(r=>r.durationMs)),statistics:verified.statistics.current,recovery:retry.results.map(r=>({id:r.id,ms:r.elapsedMs,status:r.status}))}));
