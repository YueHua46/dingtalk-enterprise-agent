import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const directory = '/tmp/listing-export-scan-' + randomUUID();
const exec = code => execFileSync('docker', ['exec', 'dingtalk-enterprise-agent-gateway-1', 'node', '--input-type=module', '-e', code], { encoding: 'utf8', maxBuffer: 100000 });
const results = [];
try {
  exec(`import fs from 'node:fs';fs.mkdirSync('${directory}')`);
  for (const ext of ['docx', 'xlsx']) {
    const encoded = (await readFile('examples/listing/listing-export-sample.' + ext)).toString('base64');
    const path = directory + '/sample.' + ext;
    for (let at = 0; at < encoded.length; at += 12000) exec(`import fs from 'node:fs';fs.appendFileSync('${path}',Buffer.from('${encoded.slice(at, at + 12000)}','base64'))`);
    const result = JSON.parse(exec(`import fs from 'node:fs';import {scanClamAv} from '/app/dist/media.js';const result=await scanClamAv('clamav',3310,fs.readFileSync('${path}'));if(!result.endsWith('OK'))throw Error('SCAN_FAILED');console.log(JSON.stringify({extension:'${ext}',result}))`));
    results.push(result);
  }
  await writeFile('output/listing/export/scan-results.json', JSON.stringify({ realClamAv: true, results, noDwsCalls: true }, null, 2));
  console.log(JSON.stringify({ realClamAv: true, results }));
} finally { exec(`import fs from 'node:fs';fs.rmSync('${directory}',{recursive:true,force:true})`); }
