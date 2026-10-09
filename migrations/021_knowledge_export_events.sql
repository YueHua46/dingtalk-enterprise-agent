ALTER TABLE knowledge_sheet_exports DROP CONSTRAINT knowledge_sheet_exports_state_check;
ALTER TABLE knowledge_sheet_exports ADD CHECK(state IN ('starting','complete','failed','retry_authorized'));
ALTER TABLE knowledge_sheet_exports ADD COLUMN attempt_id uuid;
CREATE TABLE knowledge_export_events (
 id bigserial PRIMARY KEY,
 corp_id text NOT NULL,user_id text NOT NULL,node_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sheet','pdf')),
 attempt_id uuid NOT NULL,event text NOT NULL,
 job_id text,source_hash text,diagnostic jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(job_id IS NULL OR job_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 CHECK(source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX knowledge_export_events_source ON knowledge_export_events(corp_id,user_id,node_id,kind,id);
-- Events intentionally survive ledger changes. No response bodies or URLs.
