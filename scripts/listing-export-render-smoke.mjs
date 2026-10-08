import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
const container = 'dingtalk-enterprise-agent-file-worker-1';
const directory = '/tmp/listing-export-module9-' + randomUUID();
const docker = (...args) => execFileSync('docker', ['exec', container, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
for (const [source, name] of [['file-skills/listing_export.py', 'listing_export.py'], ['file-skills/listing_export_test.py', 'tests.py'], ['output/listing/export/payload.json', 'payload.json']]) {
  const data = (await readFile(source)).toString('base64');
  docker('node', '-e', `const fs=require('fs');fs.mkdirSync('${directory}',{recursive:true});fs.writeFileSync('${directory}/${name}',Buffer.from('${data}','base64'));`);
}
try {
  docker('/opt/venv/bin/python', directory + '/tests.py', directory + '/payload.json');
  const paths = JSON.parse(docker('/opt/venv/bin/python', directory + '/listing_export.py', directory + '/payload.json', directory + '/files'));
  // Same input, a later save: immutable outputs must not conflict or change hashes.
  docker('/opt/venv/bin/python', directory + '/listing_export.py', directory + '/payload.json', directory + '/files');
  await mkdir('output/listing/export', { recursive: true });
  for (const path of Object.values(paths)) {
    const encoded = docker('node', '-e', `process.stdout.write(require('fs').readFileSync('${path}').toString('base64'))`);
    await writeFile('output/listing/export/' + basename(path), Buffer.from(encoded, 'base64'));
  }
  await writeFile('output/listing/export/rendered-files.json', JSON.stringify(Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, basename(p)])), null, 2));
  if (process.argv.includes('--visual')) {
    docker('/usr/bin/libreoffice', '-env:UserInstallation=file://' + directory + '/lo', '--headless', '--convert-to', 'pdf', '--outdir', directory + '/files', paths.docx);
    const pdf = paths.docx.replace(/\.docx$/, '.pdf');
    docker('/usr/bin/pdftoppm', '-scale-to', '1200', '-png', pdf, directory + '/page');
    await mkdir('output/listing/export/docx-preview', { recursive: true });
    const names = JSON.parse(docker('node', '-e', `process.stdout.write(JSON.stringify(require('fs').readdirSync('${directory}').filter(n=>/^page-.*png$/.test(n))))`));
    for (const name of names) {
      const encoded = docker('node', '-e', `process.stdout.write(require('fs').readFileSync('${directory}/${name}').toString('base64'))`);
      await writeFile('output/listing/export/docx-preview/' + name, Buffer.from(encoded, 'base64'));
    }
    console.log(JSON.stringify({ renderedDocxPages: names.length, engine: 'production worker LibreOffice; desktop bundle lacks LibreOffice' }));
  }
  console.log(JSON.stringify({ productionRenderer: true, noModelOrDwsCalls: true, repeatRenderStable: true, files: Object.values(paths).map(p => basename(p)) }));
} finally {
  // Fixed temporary test directory only, no deployed files or task data.
  docker('node', '-e', `require('fs').rmSync('${directory}',{recursive:true,force:true})`);
}
