import type { Pool } from 'pg';
import type { ListingRevisionVersion, ListingRevisionResult, ListingRevisionScope } from './listing-revision.js';

export interface RevisionOperation { requestHash: string; baseId: string | null; state: 'pending' | 'completed'; result: ListingRevisionResult | null }
export interface ListingRevisionStore {
  getHead(scope: ListingRevisionScope): Promise<ListingRevisionVersion | null>;
  getVersion(scope: ListingRevisionScope, id: string): Promise<ListingRevisionVersion | null>;
  getOperation(scope: ListingRevisionScope, operationId: string): Promise<RevisionOperation | null>;
  begin(scope: ListingRevisionScope, operationId: string, requestHash: string, baseId: string | null): Promise<'started' | 'duplicate' | 'stale'>;
  finish(scope: ListingRevisionScope, operationId: string, requestHash: string, result: ListingRevisionResult): Promise<ListingRevisionResult>;
}
const stale = (): ListingRevisionResult => ({ status: 'revision_failed', code: 'stale_version' });
const key = (s: ListingRevisionScope) => JSON.stringify([s.owner.corpId, s.owner.userId, s.surface.type, s.surface.id, s.requestId]);
const params = (s: ListingRevisionScope) => [s.owner.corpId, s.owner.userId, s.surface.type, s.surface.id, s.requestId];
function assertVersion(s: ListingRevisionScope, id: string, base: string | null, v: ListingRevisionVersion) {
  if (key(v.scope) !== key(s) || v.operationId !== id || v.parentId !== base || !Number.isSafeInteger(v.ordinal) || v.ordinal < 1) throw new Error('LISTING_REVISION_VERSION_INVALID');
}

/** Tests and local replay only. Production uses the durable Pg adapter. */
export class MemoryListingRevisionStore implements ListingRevisionStore {
  private readonly sessions = new Map<string, { head: string | null; versions: Map<string, ListingRevisionVersion>; operations: Map<string, RevisionOperation> }>();
  private session(s: ListingRevisionScope) {
    const k = key(s); let entry = this.sessions.get(k);
    if (!entry) { entry = { head: null, versions: new Map(), operations: new Map() }; this.sessions.set(k, entry); }
    return entry;
  }
  async getHead(s: ListingRevisionScope) { const e = this.session(s); return structuredClone(e.head ? e.versions.get(e.head)! : null); }
  async getVersion(s: ListingRevisionScope, id: string) { return structuredClone(this.session(s).versions.get(id) ?? null); }
  async getOperation(s: ListingRevisionScope, id: string) { return structuredClone(this.session(s).operations.get(id) ?? null); }
  async begin(s: ListingRevisionScope, id: string, requestHash: string, baseId: string | null) {
    const e = this.session(s); if (e.operations.has(id)) return 'duplicate' as const;
    if (e.head !== baseId) return 'stale' as const;
    e.operations.set(id, { requestHash, baseId, state: 'pending', result: null }); return 'started' as const;
  }
  async finish(s: ListingRevisionScope, id: string, requestHash: string, result: ListingRevisionResult) {
    const e = this.session(s), op = e.operations.get(id);
    if (!op || op.requestHash !== requestHash) throw new Error('LISTING_REVISION_OPERATION_INVALID');
    if (op.state === 'completed') return structuredClone(op.result!);
    const actual = e.head !== op.baseId ? stale() : result;
    if (actual.status === 'version_saved') { assertVersion(s, id, op.baseId, actual.version); e.versions.set(actual.version.id, structuredClone(actual.version)); e.head = actual.version.id; }
    op.state = 'completed'; op.result = structuredClone(actual); return structuredClone(actual);
  }
}

/** Every SQL access includes current user, original conversation and listing session. */
export class PgListingRevisionStore implements ListingRevisionStore {
  constructor(private readonly pool: Pool) {}
  async getHead(s: ListingRevisionScope): Promise<ListingRevisionVersion | null> {
    const { rows } = await this.pool.query(`SELECT v.payload_text FROM listing_revision_sessions s JOIN listing_revision_versions v
      ON v.corp_id=s.corp_id AND v.user_id=s.user_id AND v.surface_type=s.surface_type AND v.surface_id=s.surface_id
      AND v.request_id=s.request_id AND v.version_id=s.head_id
      WHERE s.corp_id=$1 AND s.user_id=$2 AND s.surface_type=$3 AND s.surface_id=$4 AND s.request_id=$5`, params(s));
    return rows[0] ? JSON.parse(rows[0].payload_text) : null;
  }
  async getVersion(s: ListingRevisionScope, id: string): Promise<ListingRevisionVersion | null> {
    const { rows } = await this.pool.query(`SELECT payload_text FROM listing_revision_versions
      WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 AND version_id=$6`, [...params(s), id]);
    return rows[0] ? JSON.parse(rows[0].payload_text) : null;
  }
  async getOperation(s: ListingRevisionScope, id: string): Promise<RevisionOperation | null> {
    const { rows } = await this.pool.query(`SELECT request_hash,base_id,state,result_text FROM listing_revision_operations
      WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 AND operation_id=$6`, [...params(s), id]);
    const row = rows[0]; return row ? { requestHash: row.request_hash, baseId: row.base_id, state: row.state, result: row.result_text ? JSON.parse(row.result_text) : null } : null;
  }
  async begin(s: ListingRevisionScope, id: string, requestHash: string, baseId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO listing_revision_sessions(corp_id,user_id,surface_type,surface_id,request_id)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, params(s));
      const lock = await client.query(`SELECT head_id FROM listing_revision_sessions
        WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 FOR UPDATE`, params(s));
      const prior = await client.query(`SELECT 1 FROM listing_revision_operations
        WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 AND operation_id=$6`, [...params(s), id]);
      const result = prior.rowCount ? 'duplicate' as const : lock.rows[0].head_id !== baseId ? 'stale' as const : 'started' as const;
      if (result === 'started') await client.query(`INSERT INTO listing_revision_operations
        (corp_id,user_id,surface_type,surface_id,request_id,operation_id,request_hash,base_id,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')`, [...params(s), id, requestHash, baseId]);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async finish(s: ListingRevisionScope, id: string, requestHash: string, result: ListingRevisionResult): Promise<ListingRevisionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query(`SELECT head_id FROM listing_revision_sessions
        WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 FOR UPDATE`, params(s));
      const saved = await client.query(`SELECT * FROM listing_revision_operations
        WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 AND operation_id=$6`, [...params(s), id]);
      const op = saved.rows[0]; if (!op || op.request_hash !== requestHash) throw new Error('LISTING_REVISION_OPERATION_INVALID');
      if (op.state === 'completed') { await client.query('COMMIT'); return JSON.parse(op.result_text); }
      const actual = lock.rows[0].head_id !== op.base_id ? stale() : result;
      if (actual.status === 'version_saved') {
        const v = actual.version;
        assertVersion(s, id, op.base_id, v);
        await client.query(`INSERT INTO listing_revision_versions(corp_id,user_id,surface_type,surface_id,request_id,version_id,ordinal,parent_id,operation_id,payload_text)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...params(s), v.id, v.ordinal, v.parentId, id, JSON.stringify(v)]);
        await client.query(`UPDATE listing_revision_sessions SET head_id=$6
          WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5`, [...params(s), v.id]);
      }
      await client.query(`UPDATE listing_revision_operations SET state='completed',result_text=$7
        WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND request_id=$5 AND operation_id=$6`, [...params(s), id, JSON.stringify(actual)]);
      await client.query('COMMIT'); return actual;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
