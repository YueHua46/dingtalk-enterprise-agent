-- Sheet has a one-shot export contract and no independent resume endpoint.
-- Failure/unknown outcome must survive process restarts and parser upgrades.
CREATE TABLE knowledge_sheet_exports (
 corp_id text NOT NULL, user_id text NOT NULL, node_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('starting','complete','failed')),
 job_id text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(corp_id,user_id,node_id),
 CHECK(job_id IS NULL OR job_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 FOREIGN KEY(corp_id,user_id,node_id) REFERENCES knowledge_resources ON DELETE CASCADE
);
