import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { buildListingExport } from '../dist/listing-export.js';
const { version, previous } = JSON.parse(await readFile(new URL('../examples/listing/export-version-sample.json', import.meta.url), 'utf8'));
const payload = buildListingExport(version.scope, version, version.context, { previous });
await mkdir(new URL('../output/listing/export/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/listing/export/payload.json', import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL('../output/listing/export/summary.txt', import.meta.url), payload.summary);
console.log(JSON.stringify({ versionId: payload.versionId, sections: payload.sections.length, fields: payload.sections[0].rows.length,
  copyable: payload.sections[0].rows.filter(r => r[4]).length, pendingRulesRetained: true }));
