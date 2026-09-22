import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgres://agent:agent@localhost:5432/agent';
const pool = new Pool({ connectionString });
const migrationsUrl = new URL('../migrations/', import.meta.url);
try {
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', ['dingtalk-enterprise-agent:migrations']);
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = (await readdir(migrationsUrl)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  for (const name of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
    if (applied.rowCount) continue;
    const sql = await readFile(new URL(name, migrationsUrl), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await client.query('COMMIT');
      console.log('applied migration ' + name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  console.log('database migrations complete');
} finally {
  await pool.query('SELECT pg_advisory_unlock(hashtext($1))', ['dingtalk-enterprise-agent:migrations']).catch(() => undefined);
  await pool.end();
}
