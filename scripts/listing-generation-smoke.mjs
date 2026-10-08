import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Isolated temporary code. No deployment, restart, DWS reads, messages or credential output.
const run = promisify(execFile);
const container = process.env.LISTING_SMOKE_CONTAINER ?? 'dingtalk-enterprise-agent-gateway-1';
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('INVALID_CONTAINER_NAME');
const root = '/tmp/listing-generation-smoke-' + randomUUID();
const files = ['dist/listing-input.js', 'dist/listing-facts.js', 'dist/listing-planning.js', 'dist/listing-rules.js',
  'dist/listing-generation.js', 'dist/structured-model.js', 'config/listing-planning.json', 'config/listing-generation.json',
  'config/listing-rules.us-en.json', 'examples/listing/camera-product.txt', 'scripts/listing-generation-sample.mjs'];
async function docker(args, timeout = 20000) { return run('docker', args, { windowsHide: true, timeout, maxBuffer: 500000 }); }
try {
  await docker(['exec', container, 'node', '-e', 'const fs=require("fs");const p=process.argv[1];for(const d of ["dist","config","examples/listing","scripts","output/listing"])fs.mkdirSync(p+"/"+d,{recursive:true});fs.symlinkSync("/app/node_modules",p+"/node_modules");fs.writeFileSync(p+"/package.json",JSON.stringify({type:"module"}));', root]);
  // Use exec rather than docker cp: daemon copying cannot see this host's /tmp mount.
  for (const file of files) await docker(['exec', container, 'node', '-e',
    'require("fs").writeFileSync(process.argv[1],Buffer.from(process.argv[2],"base64"));', root + '/' + file,
    (await readFile(new URL('../' + file, import.meta.url))).toString('base64')]);
  const outcome = await docker(['exec', container, 'node', root + '/scripts/listing-generation-sample.mjs', '--live'], 270000);
  process.stdout.write(outcome.stdout);
  await mkdir(new URL('../output/listing/', import.meta.url), { recursive: true });
  const report = await docker(['exec', container, 'node', '-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"));', root + '/output/listing/generation-smoke.json']);
  await writeFile(new URL('../output/listing/generation-smoke.json', import.meta.url), report.stdout, 'utf8');
} catch (error) {
  // Only controlled model result summaries; never dump transport stderr or environment.
  if (typeof error.stdout === 'string') process.stdout.write(error.stdout);
  try {
    await mkdir(new URL('../output/listing/', import.meta.url), { recursive: true });
    const report = await docker(['exec', container, 'node', '-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"));', root + '/output/listing/generation-smoke.json']);
    await writeFile(new URL('../output/listing/generation-smoke.json', import.meta.url), report.stdout, 'utf8');
  } catch { /* No result on infrastructure failure. */ }
  console.error('LISTING_GENERATION_SMOKE_FAILED'); process.exitCode = 1;
} finally {
  try {
    await docker(['exec', container, 'node', '-e', 'const p=process.argv[1];const prefix="/tmp/listing-generation-smoke-";if(!p.startsWith(prefix)||!/^[a-f0-9-]+$/.test(p.slice(prefix.length)))throw Error("INVALID_TEMP_PATH");require("fs").rmSync(p,{recursive:true,force:true});', root]);
  } catch { console.error('LISTING_SMOKE_TEMP_CLEANUP_FAILED'); process.exitCode = 1; }
}
