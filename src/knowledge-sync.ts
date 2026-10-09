import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import type { DwsBroker } from './dws-broker.js';
import { fingerprint, credentialVault, knowledgeParserVersion } from './knowledge-parse.js';
import type { KnowledgeModel } from './knowledge-model.js';
import { KnowledgeStore, type KnowledgeResource } from './knowledge-store.js';
import type { KnowledgeSource } from './knowledge-source.js';
import { knowledgeFailures } from './knowledge-metrics.js';
import { KnowledgeExport } from './knowledge-export.js';

export function resourceFromNode(node: Record<string, any>, workspaceId: string, path: string, parentId: string | null): KnowledgeResource {
  if (typeof node.nodeId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(node.nodeId) || typeof node.name !== 'string') throw new Error('KNOWLEDGE_NODE_INVALID');
  const metadata = { nodeId:node.nodeId,workspaceId, name:node.name,extension:node.extension ?? '',type:node.type,
    updateTime:node.updateTime ?? null,parentFolderId:node.parentFolderId ?? parentId };
  return { nodeId:node.nodeId,workspaceId,parentId:node.parentFolderId ?? parentId,title:node.name,path,
    extension:node.type === 'folder' ? 'folder' : String(node.extension ?? ''),
    sourceUrl:`https://alidocs.dingtalk.com/i/nodes/${node.nodeId}`,metadata,metadataHash:fingerprint(metadata) };
}
export function sourceMetadataHash(node: Record<string, any>, resource: KnowledgeResource): string {
  return resourceFromNode(node,resource.workspaceId,resource.path,resource.parentId).metadataHash;
}
export function knowledgeErrorCode(error: unknown): string {
  const diagnostic=error as {dwsCode?:string;dwsCategory?:string;dwsReason?:string;dwsCauseCode?:string};
  const message = (error instanceof Error ? error.message : '')+' '+(diagnostic.dwsCode ?? '')+' '+(diagnostic.dwsCategory ?? '');
  // Provider/worker HTTP codes are not DingTalk access decisions.
  if (error instanceof Error && /^KNOWLEDGE_[A-Z_0-9]+$/.test(error.message)) return error.message;
  if(diagnostic.dwsReason==='doc_export_download_failed'&&diagnostic.dwsCauseCode==='NoSuchKey')return 'KNOWLEDGE_DWS_EXPORT_OBJECT_MISSING';
  if(error instanceof Error&&error.message==='DWS_COMMAND_TIMEOUT')return 'KNOWLEDGE_DWS_TIMEOUT';
  if(error instanceof Error&&error.message==='DWS_OUTPUT_LIMIT')return 'KNOWLEDGE_DWS_OUTPUT_LIMIT';
  // An internal CLI/download/filesystem failure is not a DingTalk access
  // decision. Its text can mention 403/404 or permission without any server
  // evidence that the employee lost source access.
  if(diagnostic.dwsCategory==='internal')return 'KNOWLEDGE_DWS_INTERNAL_ERROR';
  if (/DWS_OAUTH_REQUIRED|auth.*expired|token.*expired|unauthori[sz]ed/i.test(message)) return 'auth_required';
  if (/forbidden|permission|access.denied|权限|无权|403/i.test(message)) return 'permission_denied';
  if (/not.found|已删除|不存在|404/i.test(message)) return 'not_found';
  return 'source_read_failed'; // No raw DWS errors/URLs/secrets in persisted reports.
}
export class KnowledgeSync {
  private connection: Redis | undefined;
  private workerConnection: Redis | undefined;
  private queue: Queue<UserIdentity> | undefined;
  private worker: Worker<UserIdentity> | undefined;
  private refreshQueue: Queue<UserIdentity & {nodeId:string}> | undefined;
  private refreshWorker: Worker<UserIdentity & {nodeId:string}> | undefined;
  private timer: NodeJS.Timeout | undefined;
  public constructor(private readonly config: Config, public readonly store: KnowledgeStore, private readonly dws: DwsBroker,
    public readonly source: KnowledgeSource, private readonly model: KnowledgeModel) {}
  public allowed(user: UserIdentity): boolean {
    return this.config.KNOWLEDGE_ENABLED === 'true' || this.config.KNOWLEDGE_TEST_USERS.split(',').map((s) => s.trim()).includes(`${user.corpId}:${user.userId}`);
  }
  public async start(): Promise<void> {
    if(this.config.KNOWLEDGE_AUTO_SYNC==='false')return;
    this.connection = new Redis(this.config.REDIS_URL,{maxRetriesPerRequest:null});
    this.workerConnection = this.connection.duplicate();
    this.queue = new Queue('dingtalk-knowledge-sync',{connection:this.connection});
    this.worker = new Worker<UserIdentity>('dingtalk-knowledge-sync',async (job) => { await this.scan(job.data); },{connection:this.workerConnection,concurrency:2});
    this.worker.on('error',() => { /* Queue health is observable without credential-bearing diagnostics. */ });
    this.refreshQueue=new Queue('dingtalk-knowledge-refresh',{connection:this.connection});
    this.refreshWorker=new Worker<UserIdentity & {nodeId:string}>('dingtalk-knowledge-refresh',async(job)=>{
      if(!this.allowed(job.data))return;
      const employee=await this.store.pool.query('SELECT disabled_at FROM users WHERE corp_id=$1 AND user_id=$2',[job.data.corpId,job.data.userId]);
      if(employee.rows[0]?.disabled_at)return;
      const resource=await this.store.resource(job.data,job.data.nodeId);
      if(!resource||!this.source.supported(resource))return;
      const client=await this.store.pool.connect(),key=fingerprint([job.data.corpId,job.data.userId,job.data.nodeId]);
      try{
        const locked=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key]);
        if(!locked.rows[0].locked)return;
        const metadata=await this.source.metadata(job.data,resource.nodeId);
        const current={...resource,...resourceFromNode(metadata,resource.workspaceId,resource.path,resource.parentId)};
        if(current.metadataHash!==resource.metadataHash)await this.store.updateMetadata(job.data,current);
        await this.refresh(job.data,current);
      }catch(error){
        const code=knowledgeErrorCode(error);knowledgeFailures.inc({code});
        await this.store.failure(job.data,resource.nodeId,code);
        if(code==='auth_required')await this.store.pool.query('UPDATE knowledge_users SET paused=true WHERE corp_id=$1 AND user_id=$2',[job.data.corpId,job.data.userId]);
      }finally{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);client.release();}
    },{connection:this.workerConnection,concurrency:1});
    this.refreshWorker.on('error',()=>undefined);
    const tick = async () => {
      await this.store.pool.query(`UPDATE knowledge_users k SET enabled=false,paused=true FROM users u
        WHERE u.corp_id=k.corp_id AND u.user_id=k.user_id AND u.disabled_at IS NOT NULL`);
      const users = await this.store.pool.query(`SELECT corp_id,user_id FROM knowledge_users WHERE enabled AND NOT paused
        AND (last_scan IS NULL OR last_scan<now()-($1::bigint*interval '1 millisecond'))
        UNION SELECT u.corp_id,u.user_id FROM users u WHERE u.dws_authenticated_at IS NOT NULL AND u.disabled_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM knowledge_users k WHERE k.corp_id=u.corp_id AND k.user_id=u.user_id)`,[this.config.KNOWLEDGE_SYNC_INTERVAL_MS]);
      for (const row of users.rows) await this.enqueue({corpId:row.corp_id,userId:row.user_id});
      await this.store.retire();
      await new KnowledgeExport(this.store.pool,this.config.KNOWLEDGE_DIR,this.config.KNOWLEDGE_MAX_SOURCE_BYTES,async()=>{throw new Error('KNOWLEDGE_EXPORT_CLEANUP_ONLY');}).retireArtifacts();
    };
    await tick();
    this.timer = setInterval(() => { void tick().catch(() => undefined); },60_000); this.timer.unref();
  }
  public async enqueue(user: UserIdentity): Promise<void> {
    if(this.config.KNOWLEDGE_AUTO_SYNC==='false')return;
    if (!this.allowed(user)) return;
    const employee=await this.store.pool.query('SELECT disabled_at FROM users WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);
    if (employee.rows[0]?.disabled_at) return;
    await this.store.enable(user);
    if(!this.queue)return;
    const due=await this.store.pool.query(`SELECT 1 FROM knowledge_users WHERE corp_id=$1 AND user_id=$2 AND enabled AND NOT paused
      AND (last_scan IS NULL OR last_scan<now()-($3::bigint*interval '1 millisecond'))`,[user.corpId,user.userId,this.config.KNOWLEDGE_SYNC_INTERVAL_MS]);
    if(!due.rowCount)return;
    await this.queue?.add('scan',{corpId:user.corpId,userId:user.userId},{jobId:fingerprint([user.corpId,user.userId]),attempts:1,priority:10,removeOnComplete:true,removeOnFail:true});
  }
  // Only call after this employee's completed OAuth or successful live read.
  // Ordinary scheduling must never resume an expired authorization.
  public async authorizationVerified(user: UserIdentity): Promise<void> {
    if(this.config.KNOWLEDGE_AUTO_SYNC==='false')return;
    if (!this.allowed(user)) return;
    await this.store.pool.query(`UPDATE knowledge_users SET paused=false,last_scan=NULL
      WHERE corp_id=$1 AND user_id=$2 AND paused AND enabled`,[user.corpId,user.userId]);
    await this.enqueue(user);
  }
  public async enqueueResource(user:UserIdentity,nodeId:string):Promise<void>{
    if(this.config.KNOWLEDGE_AUTO_SYNC==='false')return;
    if(!this.allowed(user))return;
    await this.refreshQueue?.add('refresh',{corpId:user.corpId,userId:user.userId,nodeId},{jobId:fingerprint([user.corpId,user.userId,nodeId]),attempts:1,removeOnComplete:true,removeOnFail:true});
  }
  public async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();await this.refreshWorker?.close();await this.queue?.close();await this.refreshQueue?.close();await this.workerConnection?.quit();await this.connection?.quit();
  }
  public async scan(user: UserIdentity, options: {catalogOnly?:boolean} = {}): Promise<unknown> {
    if (!this.allowed(user)) throw new Error('KNOWLEDGE_DISABLED');
    const client = await this.store.pool.connect(), key = fingerprint([user.corpId,user.userId]);
    let run: string | undefined;
    const counts: Record<string,number> = { nodes:0,ready:0,failed:0,excluded:0 };
    try {
      const locked = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key]);
      if (!locked.rows[0].locked) return {skipped:'already_running'};
      await client.query('UPDATE knowledge_users SET last_scan=now() WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);
      const record = await client.query('INSERT INTO knowledge_sync_runs(corp_id,user_id) VALUES($1,$2) RETURNING id',[user.corpId,user.userId]); run=record.rows[0].id;
      const spaces = await this.dws.runCommand(user,['wiki','+space-list','--type','orgWikiSpace','--limit','50','--page-all'],{background:true}) as any;
      if (spaces.requestedType !== 'orgWikiSpace' || spaces.autoPageComplete !== true || !Array.isArray(spaces.spaces)) throw new Error('KNOWLEDGE_DIRECTORY_INCOMPLETE');
      const discovered: KnowledgeResource[] = []; let complete = true;
      for (const space of spaces.spaces) {
        const folders: Array<{node:string|null;path:string}> = [{node:null,path:space.name}], seen = new Set<string|null>();
        while (folders.length) {
          const folder = folders.shift()!; if (seen.has(folder.node)) continue; seen.add(folder.node);
          const result = await this.dws.runCommand(user,['wiki','+node-list','--workspace',space.workspaceId,...(folder.node?['--folder',folder.node]:[]),'--page-all'],{background:true}) as any;
          if (!Array.isArray(result.nodes)) throw new Error('KNOWLEDGE_DIRECTORY_INVALID');
          if (result.autoPageComplete !== true) complete=false;
          for (const node of result.nodes) {
            const resource = resourceFromNode(node,space.workspaceId,folder.path+'/'+node.name,folder.node);
            const needsRead = await this.store.discover(user,resource,run!);counts.nodes!++;
            if (resource.parentId) await client.query(`INSERT INTO knowledge_relations(corp_id,user_id,entry_node,target_node,kind)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[user.corpId,user.userId,resource.parentId,resource.nodeId,'parent:'+space.workspaceId]);
            if (node.hasChildren === true) folders.push({node:node.nodeId,path:resource.path});
            if (!this.source.supported(resource)) {
              await this.store.state(user,resource.nodeId,credentialVault(resource.path)?'credential_excluded':'catalog_only');counts.excluded!++;
            } else if (needsRead) discovered.push(resource);
          }
        }
      }
      // Finish directory coverage before slow parsing so all files remain visible
      // even when model or document decoding fails.
      await client.query('UPDATE knowledge_sync_runs SET directory_complete=$2,counts=$3 WHERE id=$1',[run,complete,JSON.stringify(counts)]);
      if (complete) await client.query(`UPDATE knowledge_resources SET status='directory_absent' WHERE corp_id=$1 AND user_id=$2 AND seen_run IS DISTINCT FROM $3`,[user.corpId,user.userId,run]);
      for (const resource of options.catalogOnly ? [] : discovered) {
        try { await this.refresh(user,resource);counts.ready!++; }
        catch (error) {
          const code = knowledgeErrorCode(error);counts.failed!++;
          knowledgeFailures.inc({code});
          await this.store.failure(user,resource.nodeId,code);
          if (code === 'auth_required') throw error;
        }
      }
      await client.query(`UPDATE knowledge_sync_runs SET status=$2,finished_at=now(),counts=$3 WHERE id=$1`,[run,options.catalogOnly?'catalog_complete':complete && !counts.failed?'complete':'partial',JSON.stringify(counts)]);
      await client.query(`UPDATE knowledge_users SET last_scan=now(),paused=false WHERE corp_id=$1 AND user_id=$2`,[user.corpId,user.userId]);
      return {directoryComplete:complete,counts};
    } catch (error) {
      const code = knowledgeErrorCode(error);
      if (run) await client.query(`UPDATE knowledge_sync_runs SET status='failed',finished_at=now(),error_code=$2,counts=$3 WHERE id=$1`,[run,code,JSON.stringify(counts)]);
      if (code === 'auth_required') await client.query('UPDATE knowledge_users SET paused=true WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId]);
      throw new Error(code);
    } finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);client.release(); }
  }
  public async refresh(user: UserIdentity, resource: KnowledgeResource, background = true, checkBudget:()=>void=()=>{}): Promise<{version:string;content:import('./knowledge-parse.js').KnowledgeContent}> {
    checkBudget();
    const body=await this.source.read(user,resource,false,new Set(),background);
    checkBudget();
    // Persist target access dependencies even when unchanged content or shared
    // vectors let us skip reindexing. Ordinary reads still check these targets.
    if (body.target) await this.store.pool.query(`INSERT INTO knowledge_relations(corp_id,user_id,entry_node,target_node,kind)
      VALUES($1,$2,$3,$4,'shortcut') ON CONFLICT DO NOTHING`,[user.corpId,user.userId,resource.nodeId,body.target]);
    const existing=await this.store.pool.query(`SELECT v.id,v.source_hash,v.quality FROM knowledge_resources r JOIN knowledge_versions v ON v.id=r.active_version
      WHERE r.corp_id=$1 AND r.user_id=$2 AND r.node_id=$3 AND v.embedding_model=$4 AND v.parser_version=$5`,
      [user.corpId,user.userId,resource.nodeId,this.config.EMBEDDING_MODEL,knowledgeParserVersion]);
    const old=existing.rows[0];
    if(old?.source_hash===body.hash && !(old.quality as string[]).some(q=>/image_pending|image_not_verified|no_text/.test(q))) {
      const chunks=await this.store.pool.query('SELECT text,position,method FROM knowledge_chunks WHERE version_id=$1 ORDER BY ordinal',[old.id]);
      const updated=await this.store.pool.query(`UPDATE knowledge_resources SET status='ready',error_code=NULL,verified_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND metadata_hash=$4 AND active_version=$5`,
        [user.corpId,user.userId,resource.nodeId,resource.metadataHash,old.id]);
      if(!updated.rowCount)throw new Error('KNOWLEDGE_SOURCE_CHANGED_DURING_PARSE');
      return {version:old.id,content:{...body.content,chunks:chunks.rows,quality:old.quality}};
    }
    const shared=await this.store.sharedResource(user,resource.nodeId);
    if(shared?.activeVersion){
      checkBudget();
      const hash=await this.store.pool.query('SELECT source_hash FROM knowledge_versions WHERE id=$1',[shared.activeVersion]);
      if(hash.rows[0]?.source_hash===body.hash){
        const version=await this.store.reuseVerifiedIndex(user,resource,shared.activeVersion,body.hash);
        const chunks=await this.store.pool.query('SELECT text,position,method FROM knowledge_chunks WHERE version_id=$1 ORDER BY ordinal',[version]);
        const quality=await this.store.pool.query('SELECT quality FROM knowledge_versions WHERE id=$1',[version]);
        return {version,content:{...body.content,chunks:chunks.rows,quality:quality.rows[0].quality}};
      }
    }
    // Text-only reads can be indexed directly. Images require the full vision
    // pass; avoid downloading a text-only workbook twice before embedding.
    const read=body.content.quality.some(q=>/image_pending|image_not_verified|no_text/.test(q))
      ? await this.source.read(user,resource,true,new Set(),background) : body;
    checkBudget();
    if (read.target) await this.store.pool.query(`INSERT INTO knowledge_relations(corp_id,user_id,entry_node,target_node,kind)
      VALUES($1,$2,$3,$4,'shortcut') ON CONFLICT DO NOTHING`,[user.corpId,user.userId,resource.nodeId,read.target]);
    const vectors = await this.store.embedResource(user,resource.nodeId,read.content.chunks.map((c)=>resource.title+'\n'+c.text),input=>this.model.embed(input));
    checkBudget();
    const latest=await this.source.read(user,resource,false,new Set(),background);
    checkBudget();
    if (latest.hash!==read.hash) throw new Error('KNOWLEDGE_SOURCE_CHANGED_DURING_PARSE');
    const version = await this.store.activate(user,resource,read.content,vectors,read.hash);
    return {version,content:read.content};
  }
}
