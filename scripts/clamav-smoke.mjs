import assert from 'node:assert/strict';
import { scanClamAv } from '../dist/media.js';

const host = process.env.CLAMAV_HOST || '127.0.0.1';
const port = Number(process.env.CLAMAV_PORT || 3310);

const cleanResult = await scanClamAv(host, port, Buffer.from('dingtalk enterprise agent clean smoke test'));
assert.match(cleanResult, /OK$/);

// Build the standard EICAR payload at runtime so source-code scanners do not
// quarantine this smoke-test file itself.
const eicar = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!',
  '$H+H*'
].join('');
const infectedResult = await scanClamAv(host, port, Buffer.from(eicar));
assert.match(infectedResult, /FOUND$/);

console.log(JSON.stringify({ ok: true, clean: cleanResult, infected: infectedResult }));
