import type { Pool } from 'pg';
import type { UserIdentity } from './types.js';
import { fingerprint, knowledgeParserVersion, knowledgeTokens, type KnowledgeContent } from './knowledge-parse.js';

export interface KnowledgeResource {
  nodeId: string; workspaceId: string; parentId: string | null; title: string; path: string;
  extension: string; sourceUrl: string; metadata: Record<string, unknown>; metadataHash: string;
  activeVersion?: string | null; status?: string; errorCode?: string | null; verifiedAt?: string | null;
}
export class KnowledgeStore {
  private readonly imagePending=new Map<string,Promise<string>>();
  public constructor(public readonly pool: Pool, private readonly model: string,private readonly readyOnly=false,public readonly sharedIndexUsers: string[] = []) {}
  // Discovery only: this result is never permission evidence or returned to a model.
  public async sharedResource(user:UserIdentity,node:string):Promise<KnowledgeResource|undefined>{
    if(!this.sharedIndexUsers.length)return undefined;
    const {rows}=await this.pool.query(`SELECT r.* FROM knowledge_resources r JOIN knowledge_versions v ON v.id=r.active_version
      WHERE r.corp_id=$1 AND r.user_id=ANY($2::text[]) AND r.node_id=$3 AND r.status='ready'
      AND v.parser_version=$4 AND v.embedding_model=$5 AND v.quality::text !~ 'image_pending|image_not_verified|no_text'
      ORDER BY v.created_at DESC LIMIT 1`,[user.corpId,this.sharedIndexUsers,node,knowledgeParserVersion,this.model]);
    return rows[0]?fromRow(rows[0]):undefined;
  }
  // The caller has just read the complete source using the asking employee's DWS
  // identity. Hash equality permits copying vectors, never skipping that read.
  public async reuseVerifiedIndex(user:UserIdentity,resource:KnowledgeResource,version:string,sourceHash:string):Promise<string>{
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const owner=await client.query(`SELECT v.* FROM knowledge_versions v JOIN knowledge_resources r ON r.active_version=v.id
        WHERE v.id=$1 AND r.corp_id=$2 AND r.user_id=ANY($3::text[]) AND r.node_id=$4 AND r.status='ready'
        AND v.source_hash=$5 AND v.parser_version=$6 AND v.embedding_model=$7
        AND v.quality::text !~ 'image_pending|image_not_verified|no_text' FOR SHARE OF r,v`,
        [version,user.corpId,this.sharedIndexUsers,resource.nodeId,sourceHash,knowledgeParserVersion,this.model]);
      if(!owner.rowCount)throw new Error('KNOWLEDGE_SHARED_SOURCE_CHANGED');
      const lock=await client.query('SELECT metadata_hash FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 FOR UPDATE',[user.corpId,user.userId,resource.nodeId]);
      if(lock.rows[0]?.metadata_hash!==resource.metadataHash)throw new Error('KNOWLEDGE_SOURCE_CHANGED_DURING_PARSE');
      const original=owner.rows[0];
      const inserted=await client.query(`INSERT INTO knowledge_versions(corp_id,user_id,node_id,fingerprint,parser_version,embedding_model,quality,source_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(corp_id,user_id,node_id,fingerprint,parser_version,embedding_model)
        DO UPDATE SET retired_at=NULL,source_hash=excluded.source_hash RETURNING id`,
        [user.corpId,user.userId,resource.nodeId,original.fingerprint,knowledgeParserVersion,this.model,JSON.stringify(original.quality),sourceHash]);
      const own=inserted.rows[0].id as string;
      await client.query(`INSERT INTO knowledge_chunks(version_id,ordinal,text,position,method,tokens,embedding,search_vector)
        SELECT $1,ordinal,text,position,method,tokens,embedding,search_vector FROM knowledge_chunks WHERE version_id=$2 ON CONFLICT DO NOTHING`,[own,version]);
      await client.query(`INSERT INTO knowledge_facts(version_id,model,attribute,value,position,scope)
        SELECT $1,model,attribute,value,position,scope FROM knowledge_facts WHERE version_id=$2 ON CONFLICT DO NOTHING`,[own,version]);
      await client.query(`INSERT INTO knowledge_assets(version_id,digest,position,mime,content)
        SELECT $1,digest,position,mime,content FROM knowledge_assets WHERE version_id=$2 ON CONFLICT DO NOTHING`,[own,version]);
      await client.query('UPDATE knowledge_versions SET retired_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND id<>$4 AND retired_at IS NULL',[user.corpId,user.userId,resource.nodeId,own]);
      await client.query("UPDATE knowledge_resources SET active_version=$4,status='ready',error_code=NULL,verified_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3",[user.corpId,user.userId,resource.nodeId,own]);
      await client.query('COMMIT');return own;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  public async enable(user: UserIdentity): Promise<void> {
    await this.pool.query('INSERT INTO knowledge_users(corp_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [user.corpId, user.userId]);
  }
  public async resource(user: UserIdentity, nodeId: string): Promise<KnowledgeResource | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND node_id=$3', [user.corpId, user.userId, nodeId]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }
  public async discover(user: UserIdentity, resource: KnowledgeResource, run: string|null): Promise<boolean> {
    const old = await this.resource(user, resource.nodeId);
    const changed = !old || old.metadataHash !== resource.metadataHash;
    await this.pool.query(`INSERT INTO knowledge_resources(corp_id,user_id,node_id,workspace_id,parent_id,title,path,extension,source_url,metadata,metadata_hash,seen_run)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(corp_id,user_id,node_id) DO UPDATE SET workspace_id=excluded.workspace_id,parent_id=excluded.parent_id,
      title=excluded.title,path=excluded.path,extension=excluded.extension,source_url=excluded.source_url,metadata=excluded.metadata,
      metadata_hash=excluded.metadata_hash,seen_run=excluded.seen_run,updated_at=now(),
      status=CASE WHEN knowledge_resources.metadata_hash<>excluded.metadata_hash THEN 'stale' ELSE knowledge_resources.status END`,
    [user.corpId,user.userId,resource.nodeId,resource.workspaceId,resource.parentId,resource.title,resource.path,resource.extension,
      resource.sourceUrl,JSON.stringify(resource.metadata),resource.metadataHash,run]);
    if (changed || !old?.activeVersion || old.status !== 'ready' || old.errorCode) return true;
    const indexed=await this.pool.query('SELECT parser_version,embedding_model FROM knowledge_versions WHERE id=$1 AND corp_id=$2 AND user_id=$3',
      [old.activeVersion,user.corpId,user.userId]);
    return indexed.rows[0]?.parser_version!==knowledgeParserVersion || indexed.rows[0]?.embedding_model!==this.model;
  }
  public async state(user: UserIdentity, node: string, status: string, errorCode?: string): Promise<void> {
    await this.pool.query('UPDATE knowledge_resources SET status=$4,error_code=$5,updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3', [user.corpId,user.userId,node,status,errorCode ?? null]);
  }
  // A failed refresh proves nothing about whether the indexed content changed.
  // Keep its serving state; only actual access/deletion decisions disable it.
  public async failure(user: UserIdentity, node: string, code: string): Promise<void> {
    await this.pool.query(`UPDATE knowledge_resources SET error_code=$4,updated_at=now(),
      status=CASE WHEN $4='permission_denied' THEN 'denied' WHEN $4='not_found' THEN 'deleted' ELSE status END
      WHERE corp_id=$1 AND user_id=$2 AND node_id=$3`,[user.corpId,user.userId,node,code]);
  }
  public async updateMetadata(user: UserIdentity, resource: KnowledgeResource): Promise<void> {
    await this.pool.query(`UPDATE knowledge_resources SET metadata=$4,metadata_hash=$5,title=$6,parent_id=$7,extension=$8,
      status=CASE WHEN metadata_hash<>$5 THEN 'stale' ELSE status END,updated_at=now()
      WHERE corp_id=$1 AND user_id=$2 AND node_id=$3`,
      [user.corpId,user.userId,resource.nodeId,JSON.stringify(resource.metadata),resource.metadataHash,resource.title,resource.parentId,resource.extension]);
  }
  // All resource indexing uses this boundary. A new parser, batch size or
  // source revision must not silently reissue an unresolved provider refusal.
  public async embedResource(user:UserIdentity,node:string,input:string[],embed:(input:string[])=>Promise<number[][]>):Promise<number[][]>{
    const client=await this.pool.connect(),key=fingerprint(['knowledge-embedding',user.corpId,user.userId,node]);let locked=false;
    try{
      locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
      if(!locked)throw new Error('KNOWLEDGE_EMBEDDING_BUSY');
      const rejected=await client.query('SELECT 1 FROM knowledge_embedding_rejections WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[user.corpId,user.userId,node]);
      if(rejected.rowCount)throw new Error('KNOWLEDGE_EMBEDDING_REJECTED_PENDING_RESOLUTION');
      try{return await embed(input);}catch(error){
        if(error instanceof Error&&error.message==='KNOWLEDGE_EMBEDDING_HTTP_403'){
          const diagnostic=error as Error & {providerCode?:string;providerRequestId?:string};
          const code=typeof diagnostic.providerCode==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(diagnostic.providerCode)&&!/^sk-/i.test(diagnostic.providerCode)?diagnostic.providerCode:null;
          const requestId=typeof diagnostic.providerRequestId==='string'&&/^[A-Za-z0-9-]{8,128}$/.test(diagnostic.providerRequestId)?diagnostic.providerRequestId:null;
          await client.query(`INSERT INTO knowledge_embedding_rejections(corp_id,user_id,node_id,embedding_model,input_hash,provider_code,provider_request_id)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[user.corpId,user.userId,node,this.model,fingerprint(input),code,requestId]);
        }
        throw error;
      }
    }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();}
  }
  public async recognizedImage(user:UserIdentity,node:string,digest:string,modelKey:string,recognize:()=>Promise<string>):Promise<string>{
    const args=[user.corpId,user.userId,node,digest,modelKey];
    const key=fingerprint(args),pending=this.imagePending.get(key);if(pending)return pending;
    const work=(async()=>{
      const old=await this.pool.query(`UPDATE knowledge_image_results SET last_used_at=now()
        WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND digest=$4 AND model_key=$5 RETURNING text`,args);
      if(old.rows[0])return old.rows[0].text;
      const text=await recognize();
      await this.pool.query(`INSERT INTO knowledge_image_results(corp_id,user_id,node_id,digest,model_key,text)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[...args,text]);
      return text;
    })();
    this.imagePending.set(key,work);
    try{return await work;}finally{this.imagePending.delete(key);}
  }
  public async activate(user: UserIdentity, resource: KnowledgeResource, content: KnowledgeContent, vectors: number[][], sourceHash: string): Promise<string> {
    if (vectors.length !== content.chunks.length) throw new Error('KNOWLEDGE_VECTOR_COUNT_INVALID');
    const hash = fingerprint(content), client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize activation and prevent an older parse overwriting new metadata.
      const lock = await client.query(`SELECT metadata_hash FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 FOR UPDATE`, [user.corpId,user.userId,resource.nodeId]);
      if (lock.rows[0]?.metadata_hash !== resource.metadataHash) throw new Error('KNOWLEDGE_SOURCE_CHANGED_DURING_PARSE');
      const version = await client.query(`INSERT INTO knowledge_versions(corp_id,user_id,node_id,fingerprint,parser_version,embedding_model,quality,source_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(corp_id,user_id,node_id,fingerprint,parser_version,embedding_model)
        DO UPDATE SET retired_at=NULL,source_hash=excluded.source_hash RETURNING id`, [user.corpId,user.userId,resource.nodeId,hash,knowledgeParserVersion,this.model,JSON.stringify(content.quality),sourceHash]);
      const id = version.rows[0].id as string;
      const exists = await client.query('SELECT 1 FROM knowledge_chunks WHERE version_id=$1 LIMIT 1', [id]);
      if (!exists.rowCount) {
        for (const [ordinal, chunk] of content.chunks.entries()) await client.query(`INSERT INTO knowledge_chunks(version_id,ordinal,text,position,method,tokens,embedding,search_vector)
          VALUES($1,$2,$3,$4,$5,$6,$7::vector,to_tsvector('simple',$8))`, [id,ordinal,chunk.text,JSON.stringify(chunk.position),chunk.method,knowledgeTokens(resource.title+' '+chunk.text),JSON.stringify(vectors[ordinal]),resource.title+' '+resource.path+' '+chunk.text]);
        for (const fact of content.facts) await client.query(`INSERT INTO knowledge_facts(version_id,model,attribute,value,position,scope) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [id,fact.model,fact.attribute,fact.value,JSON.stringify(fact.position),fact.scope]);
        for (const asset of content.assets ?? []) {
          const match=asset.dataUrl.match(/^data:(image\/(?:jpeg|png));base64,([a-zA-Z0-9+/=]+)$/);
          if (!match) throw new Error('KNOWLEDGE_ASSET_INVALID');
          await client.query(`INSERT INTO knowledge_assets(version_id,digest,position,mime,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [id,fingerprint(asset),JSON.stringify(asset.position),match[1],Buffer.from(match[2]!,'base64')]);
        }
      }
      await client.query(`UPDATE knowledge_versions SET retired_at=COALESCE(retired_at,now()) WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND id<>$4`, [user.corpId,user.userId,resource.nodeId,id]);
      await client.query(`UPDATE knowledge_resources SET active_version=$4,status=$5,error_code=NULL,verified_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3`, [user.corpId,user.userId,resource.nodeId,id,content.chunks.length?'ready':'needs_review']);
      await client.query('COMMIT'); return id;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  public async candidates(user: UserIdentity, query: string, vector: number[], workspace?: string): Promise<any[]> {
    const params = [user.corpId,user.userId,workspace ?? null,query,knowledgeTokens(query),JSON.stringify(vector),this.model,this.readyOnly,this.sharedIndexUsers,knowledgeParserVersion];
    const { rows } = await this.pool.query(`WITH permitted AS (
      SELECT c.*,r.node_id,r.title,r.path,r.source_url,r.extension,r.metadata_hash
      FROM knowledge_resources r JOIN knowledge_chunks c ON c.version_id=r.active_version
      JOIN knowledge_versions v ON v.id=c.version_id AND v.embedding_model=$7
      WHERE r.corp_id=$1 AND (r.user_id=$2 OR (r.user_id=ANY($9::text[]) AND r.status='ready' AND v.parser_version=$10
        AND v.quality::text !~ 'image_pending|image_not_verified|no_text')) AND r.status IN ('ready','stale') AND ($3::text IS NULL OR r.workspace_id=$3 OR r.node_id=$3)
      AND (NOT $8::boolean OR (v.parser_version=$10 AND v.quality::text !~ 'image_pending|image_not_verified|no_text'))
    ), kw_scored AS (SELECT p.id,
        (CASE WHEN lower(p.title)=lower($4::text) THEN 100 ELSE 0 END)
        + cardinality(ARRAY(SELECT unnest(p.tokens) INTERSECT SELECT unnest($5::text[])))
        + ts_rank_cd(p.search_vector, plainto_tsquery('simple',$4::text)) AS lexical_score
      FROM permitted p WHERE lower(p.title)=lower($4::text) OR p.tokens && $5::text[] OR p.search_vector @@ plainto_tsquery('simple',$4::text)), kw AS (
      SELECT id,row_number() OVER(ORDER BY lexical_score DESC,id) rank FROM kw_scored ORDER BY lexical_score DESC,id LIMIT 50), vec AS (
      SELECT id,row_number() OVER(ORDER BY embedding <=> $6::vector,id) rank FROM permitted ORDER BY embedding <=> $6::vector LIMIT 30
    ), fused AS (SELECT id,sum(score) score FROM (
      SELECT id,1.0/(60+rank) score FROM kw UNION ALL SELECT id,1.0/(60+rank) FROM vec) ranks GROUP BY id)
      SELECT p.id,p.version_id,p.node_id,p.title,p.path,p.source_url,p.position,p.method,p.text,f.score,
        CASE WHEN lower(p.title)=lower($4::text) THEN 1 ELSE 0 END AS exact_title
      FROM fused f JOIN permitted p ON p.id=f.id ORDER BY exact_title DESC,f.score DESC,p.id LIMIT 60`, params);
    return rows;
  }
  public async status(user: UserIdentity, workspace?: string): Promise<unknown> {
    const resources = await this.pool.query(`SELECT status,extension,count(*)::int count FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2
      AND ($3::text IS NULL OR workspace_id=$3) GROUP BY status,extension ORDER BY status,extension`, [user.corpId,user.userId,workspace ?? null]);
    const runs = await this.pool.query('SELECT id,started_at,finished_at,status,directory_complete,counts,error_code FROM knowledge_sync_runs WHERE corp_id=$1 AND user_id=$2 ORDER BY started_at DESC LIMIT 5', [user.corpId,user.userId]);
    const gaps=await this.pool.query(`SELECT node_id,title,path,extension,status,error_code FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND (status<>'ready' OR error_code IS NOT NULL)
      AND ($3::text IS NULL OR workspace_id=$3) ORDER BY path LIMIT 1500`,[user.corpId,user.userId,workspace ?? null]);
    return { resources: resources.rows, runs: runs.rows, gaps:gaps.rows,scope: 'current_user', unsupportedAreNotEmpty: true };
  }
  // Answers need coverage counts, not every unrelated resource and historical
  // error in the employee's catalog. Detailed diagnostics remain in status().
  public async coverageSummary(user: UserIdentity, scope?: string): Promise<unknown> {
    const [resources, runs] = await Promise.all([
      this.pool.query(`SELECT status,extension,count(*)::int count FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2
        AND ($3::text IS NULL OR workspace_id=$3 OR node_id=$3) GROUP BY status,extension ORDER BY status,extension`, [user.corpId,user.userId,scope ?? null]),
      this.pool.query(`SELECT finished_at,directory_complete,status FROM knowledge_sync_runs WHERE corp_id=$1 AND user_id=$2
        ORDER BY started_at DESC LIMIT 1`,[user.corpId,user.userId])
    ]);
    return {resources:resources.rows,lastScan:runs.rows[0] ?? null,scope:'current_user',searchedScope:scope ?? null,
      unsupportedAreNotEmpty:true,detailsAvailableVia:'knowledge.status'};
  }
  public async retire(): Promise<void> {
    await this.pool.query("DELETE FROM knowledge_image_results WHERE last_used_at<now()-interval '30 days'");
    await this.pool.query(`DELETE FROM knowledge_versions v WHERE retired_at < now()-interval '30 days'
      AND NOT EXISTS(SELECT 1 FROM knowledge_resources r WHERE r.active_version=v.id)`);
    await this.pool.query(`DELETE FROM knowledge_dependencies WHERE invalidated_at<now()-interval '30 days'`);
  }
}
function fromRow(r: any): KnowledgeResource {
  return { nodeId:r.node_id,workspaceId:r.workspace_id,parentId:r.parent_id,title:r.title,path:r.path,
    extension:r.extension,sourceUrl:r.source_url,metadata:r.metadata,metadataHash:r.metadata_hash,activeVersion:r.active_version,status:r.status,errorCode:r.error_code ?? null,
    verifiedAt:r.verified_at ? new Date(r.verified_at).toISOString() : null };
}
