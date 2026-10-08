import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Test code staged only in a temporary directory. Credentials remain inside the host container.
const run = promisify(execFile), container = process.env.LISTING_SMOKE_CONTAINER ?? 'dingtalk-enterprise-agent-gateway-1';
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('INVALID_CONTAINER_NAME');
const root = '/tmp/listing-revision-pg-smoke-' + randomUUID();
const files = ['dist/listing-input.js', 'dist/listing-facts.js', 'dist/listing-planning.js', 'dist/listing-rules.js', 'dist/listing-generation.js',
  'dist/listing-validation.js', 'dist/listing-revision.js', 'dist/listing-revision-store.js', 'dist/structured-model.js',
  'config/listing-planning.json', 'config/listing-rules.us-en.json', 'config/listing-generation.json', 'config/listing-validation.json', 'config/listing-revision.json',
  'migrations/012_listing_revisions.sql', 'examples/listing/camera-product.txt', 'examples/listing/generation-sample.json',
  'scripts/listing-revision-smoke.mjs'];
async function docker(args) { return run('docker', args, { windowsHide: true, timeout: 60000, maxBuffer: 1000000 }); }
try {
  await docker(['exec', container, 'node', '-e', 'const fs=require("fs"),p=process.argv[1];for(const d of ["dist","config","examples/listing","scripts","migrations","output/listing"])fs.mkdirSync(p+"/"+d,{recursive:true});fs.symlinkSync("/app/node_modules",p+"/node_modules");fs.writeFileSync(p+"/package.json",JSON.stringify({type:"module"}));', root]);
  for (const file of [...files, 'output/listing/generation-smoke.json']) {
    let data; try { data = await readFile(new URL('../' + file, import.meta.url)); }
    catch (error) { if (file.startsWith('output/') && error.code === 'ENOENT') continue; throw error; }
    await docker(['exec', container, 'node', '-e', 'require("fs").writeFileSync(process.argv[1],Buffer.from(process.argv[2],"base64"));', root + '/' + file, data.toString('base64')]);
  }
  const response = await docker(['exec', container, 'node', root + '/scripts/listing-revision-smoke.mjs', '--postgres']);
  process.stdout.write(response.stdout);
  const report = await docker(['exec', container, 'node', '-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"));', root + '/output/listing/revision-postgres-smoke.json']);
  await mkdir(new URL('../output/listing/', import.meta.url), { recursive: true });
  await writeFile(new URL('../output/listing/revision-postgres-smoke.json', import.meta.url), report.stdout);
} catch {
  console.error('LISTING_REVISION_POSTGRES_SMOKE_FAILED'); process.exitCode = 1;
} finally {
  try { await docker(['exec', container, 'node', '-e', 'const p=process.argv[1],prefix="/tmp/listing-revision-pg-smoke-";if(!p.startsWith(prefix)||!/^[a-f0-9-]+$/.test(p.slice(prefix.length)))throw Error("INVALID_TEMP_PATH");require("fs").rmSync(p,{recursive:true,force:true});', root]); }
  catch { console.error('LISTING_REVISION_TEMP_CLEANUP_FAILED'); process.exitCode = 1; }
}
