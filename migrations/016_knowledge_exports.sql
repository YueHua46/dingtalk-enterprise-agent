-- A parser upgrade must not submit an existing export again. Legacy jobs have
-- no provable source fingerprint and therefore remain explicit coverage gaps.
CREATE TABLE knowledge_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 corp_id text NOT NULL, user_id text NOT NULL, node_id text NOT NULL,
 source_hash text, format text NOT NULL CHECK(format='pdf'),
 state text NOT NULL CHECK(state IN ('starting','job_known','complete','failed','legacy_unbound')),
 job_id text, artifact_hash text, artifact_size bigint,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$'),
 CHECK(artifact_hash IS NULL OR artifact_hash ~ '^[a-f0-9]{64}$'),
 CHECK(job_id IS NULL OR job_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 UNIQUE(corp_id,user_id,node_id,source_hash,format),
 FOREIGN KEY(corp_id,user_id,node_id) REFERENCES knowledge_resources ON DELETE CASCADE
);
CREATE UNIQUE INDEX knowledge_exports_legacy ON knowledge_exports(corp_id,user_id,node_id,format) WHERE source_hash IS NULL;
