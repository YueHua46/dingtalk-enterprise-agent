import assert from 'node:assert/strict';
import pg from 'pg';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const client = new CodexClient(config);
try {
  const result = await pool.query(
    'SELECT codex_thread_id FROM conversation_surfaces WHERE codex_thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1'
  );
  const threadId = result.rows[0]?.codex_thread_id;
  assert.ok(threadId, 'No existing conversation thread to resume');
  await client.resumeThread(threadId);
  console.log(JSON.stringify({ ok: true, existingThreadResumed: true }));
} finally {
  await client.stop();
  await pool.end();
}
