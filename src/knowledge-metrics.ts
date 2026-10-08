import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Pool } from 'pg';
export const knowledgeMetrics = new Registry();
export const knowledgeModelCalls = new Counter({name:'knowledge_model_calls_total',help:'Knowledge model calls',labelNames:['kind','status'],registers:[knowledgeMetrics]});
export const knowledgeQueries = new Histogram({name:'knowledge_query_seconds',help:'Knowledge tool latency (excludes answer generation)',labelNames:['operation'],buckets:[.5,1,2,5,10,20,30,60,120,240],registers:[knowledgeMetrics]});
export const knowledgeFailures = new Counter({name:'knowledge_source_failures_total',help:'Source verification and parsing failures',labelNames:['code'],registers:[knowledgeMetrics]});
export function registerKnowledgeDatabaseMetrics(pool:Pool):void {
  new Gauge({name:'knowledge_resources',help:'Directory resource coverage by processing state',labelNames:['state'],registers:[knowledgeMetrics],
    async collect(){
      const {rows}=await pool.query('SELECT status,count(*)::int count FROM knowledge_resources GROUP BY status');
      this.reset();for(const row of rows)this.set({state:row.status},row.count);
    }});
  new Gauge({name:'knowledge_sync_age_seconds',help:'Age of oldest enabled employee scan',registers:[knowledgeMetrics],
    async collect(){
      const {rows}=await pool.query(`SELECT COALESCE(max(extract(epoch from now()-last_scan)),0)::float8 age FROM knowledge_users WHERE enabled AND NOT paused`);
      this.set(rows[0]?.age ?? 0);
    }});
  new Gauge({name:'knowledge_last_scan_seconds',help:'Duration of most recently finished scan',registers:[knowledgeMetrics],
    async collect(){
      const {rows}=await pool.query(`SELECT extract(epoch from finished_at-started_at)::float8 duration FROM knowledge_sync_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`);
      this.set(rows[0]?.duration ?? 0);
    }});
}
