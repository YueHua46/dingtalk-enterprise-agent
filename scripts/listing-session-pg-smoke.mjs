import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const {version}=JSON.parse(await readFile(new URL('../examples/listing/export-version-sample.json',import.meta.url),'utf8'));
const code=`
import assert from 'node:assert/strict';
import pg from 'pg';
import {PgListingSessionStore} from './dist/listing-tool.js';
import {buildProductFactBook} from './dist/listing-facts.js';
const fixture=${JSON.stringify(version)};
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query('CREATE TEMP TABLE listing_tool_sessions (LIKE public.listing_tool_sessions INCLUDING ALL) ON COMMIT DROP');
 const store=new PgListingSessionStore(client);
 const session={prepared:fixture.context.prepared,context:fixture.context};
 await store.save(fixture.scope,session);
 const restored=await store.get(fixture.scope);
 assert.equal(JSON.stringify(restored),JSON.stringify(session));
 assert.equal(JSON.stringify(buildProductFactBook(restored.prepared)),JSON.stringify(restored.context.book));
 console.log(JSON.stringify({postgresSnapshotRoundTripStable:true,realFactIntegrityCheck:true,productionTablesUntouched:true}));
} finally {await client.query('ROLLBACK');client.release();await pool.end();}
`;
console.log(execFileSync('docker',['compose','exec','-T','gateway','node','--input-type=module'],{input:code,encoding:'utf8',maxBuffer:2_000_000}).trim());
