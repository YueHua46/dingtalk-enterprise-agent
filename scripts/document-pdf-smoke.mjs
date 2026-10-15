// Run after npm run build. Synthetic data only; never queries business systems.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {compiledDocumentSchema} from '../dist/document-render.js';
import {renderDocumentPdf} from '../dist/document-pdf-worker.js';

const directory=resolve(process.env.DOCUMENT_SMOKE_OUTPUT ?? 'output/pdf-smoke');
await mkdir(directory,{recursive:true});
const python=process.env.DOCUMENT_PDF_PYTHON ?? execFileSync('python',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).trim();
const samples=[
  {name:'short',document:{title:'英国站广告观察',subtitle:'演示数据 · 按问题编排的一页简报',
    metadata:[{label:'范围',value:'授权店铺 · 2026-10-01 至 2026-10-07'},{label:'币种',value:'GBP'}],blocks:[
      {id:'answer',type:'summary',text:'当前主要问题是花费集中在少数低转化投放上。先复查搜索词相关性，再决定是否调整竞价。'},
      {id:'metrics',type:'metrics',items:[{label:'广告花费',value:'£128.40'},{label:'广告销售额',value:'£512.00'},{label:'ACOS',value:'25.08%',note:'按广告归因销售额计算'}]},
      {id:'next',type:'actions',title:'优先处理',items:[{priority:'优先',object:'高花费低转化投放',proposal:'查看对应搜索词，区分无关流量与样本不足。',conditions:'这里只演示分析建议；业务调整仍需确认。'}]}
    ],sources:['本页所有数据均为合成示例，用于检查 PDF 排版。']}},
  {name:'long',document:{title:'多语言表格与图表排版验证',subtitle:'演示数据 · 日本 / Deutschland / 中国',blocks:[
    {id:'note',type:'callout',tone:'info',text:'检查中文、日文、德文字符；长名称保留全文；表格跨页重复表头；未知值不填零。'},
    {id:'trend',type:'chart',kind:'line',title:'趋势样例',categories:['周一','周二','周三','周四','周五'],series:[{label:'花费 GBP',values:[12,18,null,0,24]}],unit:'GBP'},
    {id:'longtable',type:'table',title:'完整对象列表',columns:[{field:'id',label:'对象'},{field:'name',label:'搜索词 / Kampagnenname'},{field:'spend',label:'花费 GBP'},{field:'status',label:'观察'}],
      rows:Array.from({length:70},(_,i)=>[`C-${String(i+1).padStart(3,'0')}`,i%3===0?'屋外防犯カメラ ソーラー ワイヤレス':i%3===1?'Überwachungskamera für Außenbereiche – außergewöhnlich langer Suchbegriff':'室外无线摄像机 · 搜索词核验',i===0?0:i===1?null:Math.round((i+1)*1.23*100)/100,'合成样本，非业务结论']),coverage:'显示全部 70 条合成样本。'},
    {id:'bars',type:'chart',kind:'bar',title:'多个系列与长名称',categories:Array.from({length:12},(_,i)=>`测试对象 ${i+1} – sehr langer deutscher Kampagnenname`),
      series:['甲','乙','丙','丁'].map((label,k)=>({label,values:Array.from({length:12},(_,i)=>i===k?null:(i-k)*5)})),unit:'演示值'},
    {id:'end',type:'text',paragraphs:['结束标记：END_OF_DOCUMENT。所有内容须完整保留，不为限制页数而截断。']}
  ]}}
];
const outputs=[];
for(const sample of samples){
  const payload=compiledDocumentSchema.parse({format:'pdf',theme:'ops-clean',detail:sample.name==='short'?'brief':'full',document:sample.document});
  const output=await renderDocumentPdf(payload,directory,`document-${randomUUID()}`,{python});
  outputs.push({sample:sample.name,...output});
}
await writeFile(resolve(directory,'manifest.json'),JSON.stringify(outputs,null,2));
console.log(JSON.stringify(outputs,null,2));
