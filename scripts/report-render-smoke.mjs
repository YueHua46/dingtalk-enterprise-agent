import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const task = randomUUID();
const base = process.env.FILE_WORKER_URL.replace(/\/$/, '') + '/tasks/' + task;
const headers = {'x-file-worker-secret': process.env.FILE_WORKER_SECRET, 'content-type': 'application/json'};
async function api(path, method, body) {
  const res = await fetch(base + path, {method, headers, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(100_000)});
  if (!res.ok) throw new Error(`worker ${res.status}: ${await res.text()}`);
  return res.json();
}
const started = Date.now();
await api('', 'POST');
try {
  const calculation = await api('/python', 'POST', {code: "print('x' * 70000)"});
  assert.equal(calculation.exitCode, 0);
  assert.equal(calculation.stdout.length, 70001, 'successful calculation must not silently truncate at 64k');
  const result = await api('/report-render', 'POST', {template: 'amazon-advertising', report: {
    report_title: '广告报告渲染验收', marketplace: 'DE', analysis_period: '2026-10-06 至 2026-10-12',
    store_name: '测试数据', executive_summary: '这是本地渲染测试，未查询业务数据，也不发送到聊天。',
    data_quality: {'来源': '合成测试数据', '成本': '未知'},
    sections: [{title: '自定义广告组层级', paragraphs: ['保留全部对象与六个指标，拆成两张可读表。'],
      columns: ['对象', 'CTR', 'CVR', 'CPC'], rows: Array.from({length: 40}, (_, i) => [`广告组-${i}`, '1.20%', '2.30%', '€1.50'])},
      {title: '效率与归因', columns: ['对象', 'CPA', 'ACoS', '销售额'], rows: [['广告组-39', '€65.22', '16.93%', '€100']]}],
    sources: ['合成测试：检查中文、欧元符号、分页和最后一行保留。']
  }});
  const inspection = await api('/outputs/inspect', 'POST', {path: result.path});
  for (const expected of ['自定义广告组层级', '广告组-39', '16.93%', '成本']) assert.ok(inspection.reviewText.includes(expected), expected);
  const pdf = await fetch(base + '/outputs/' + result.path, {headers});
  assert.ok(pdf.ok);
  await writeFile('/tmp/report-render-smoke.pdf', Buffer.from(await pdf.arrayBuffer()));
  console.log(JSON.stringify({ok: true, elapsedMs: Date.now()-started, calculationChars: calculation.stdout.length, textChars: inspection.reviewText.length, sha256: inspection.sha256}));
} finally {await api('', 'DELETE');}
