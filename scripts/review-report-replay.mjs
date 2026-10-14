import {readFile, writeFile} from 'node:fs/promises';
import {EvidenceReviewer} from '../dist/evidence-reviewer.js';
import {loadConfig} from '../dist/config.js';
const [workflowFile, textFile, requestFile, resultFile] = process.argv.slice(2);
const read = async path => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
const workflow = JSON.parse(await read(workflowFile));
const started = Date.now();
const result = await new EvidenceReviewer(loadConfig()).review({
  request: await read(requestFile),
  criterion: '待发布文件的完整正文；文件尚未发送是预期状态，请核验内容是否满足用户要求并受证据支持。',
  completion: {status: 'answered', answer: await read(textFile), factEvidence: {}, missingFacts: []},
  evidence: workflow.evidence, excerpts: workflow.excerpts, computeAvailable: true,
  round: 1, maxRounds: 3, profile: 'analysis'
});
await writeFile(resultFile, JSON.stringify({elapsedMs: Date.now()-started, ...result}, null, 2));
console.log(JSON.stringify({elapsedMs: Date.now()-started, status: result.status, issues: result.issues, diagnostics: result.diagnostics}));
