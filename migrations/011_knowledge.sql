CREATE EXTENSION IF NOT EXISTS vector;
-- Access and active versions are deliberately user scoped. Shared hashes are
-- not authorization evidence; a second reader must fetch the resource itself.
CREATE TABLE knowledge_resources (
 corp_id text NOT NULL, user_id text NOT NULL, node_id text NOT NULL,
 workspace_id text NOT NULL, parent_id text, title text NOT NULL, path text NOT NULL,
 extension text NOT NULL, source_url text NOT NULL, metadata jsonb NOT NULL,
 metadata_hash text NOT NULL, active_version uuid, status text NOT NULL DEFAULT 'pending',
 seen_run uuid, verified_at timestamptz, error_code text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(corp_id,user_id,node_id)
);
CREATE TABLE knowledge_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), corp_id text NOT NULL, user_id text NOT NULL,
 node_id text NOT NULL, fingerprint text NOT NULL, source_hash text NOT NULL, parser_version text NOT NULL,
 embedding_model text NOT NULL, quality jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 retired_at timestamptz, UNIQUE(corp_id,user_id,node_id,fingerprint,parser_version,embedding_model),
 FOREIGN KEY(corp_id,user_id,node_id) REFERENCES knowledge_resources ON DELETE CASCADE
);
CREATE TABLE knowledge_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES knowledge_versions ON DELETE CASCADE,
 ordinal integer NOT NULL, text text NOT NULL, position jsonb NOT NULL,
 method text NOT NULL, tokens text[] NOT NULL, embedding vector(1024) NOT NULL,
 UNIQUE(version_id,ordinal)
);
CREATE INDEX knowledge_chunks_tokens ON knowledge_chunks USING gin(tokens);
CREATE TABLE knowledge_facts (
 version_id uuid NOT NULL REFERENCES knowledge_versions ON DELETE CASCADE,
 model text NOT NULL, attribute text NOT NULL, value text NOT NULL, position jsonb NOT NULL,
 scope text NOT NULL, PRIMARY KEY(version_id,model,attribute,value)
);
CREATE TABLE knowledge_assets (
 version_id uuid NOT NULL REFERENCES knowledge_versions ON DELETE CASCADE,
 digest text NOT NULL,position jsonb NOT NULL,mime text NOT NULL,content bytea NOT NULL,
 PRIMARY KEY(version_id,digest)
);
CREATE TABLE knowledge_relations (
 corp_id text NOT NULL,user_id text NOT NULL,entry_node text NOT NULL,target_node text NOT NULL,
 kind text NOT NULL,PRIMARY KEY(corp_id,user_id,entry_node,target_node,kind)
);
CREATE TABLE knowledge_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corp_id text NOT NULL,user_id text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL DEFAULT 'running', directory_complete boolean NOT NULL DEFAULT false,
 counts jsonb NOT NULL DEFAULT '{}', error_code text
);
CREATE TABLE knowledge_users (
 corp_id text NOT NULL,user_id text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 paused boolean NOT NULL DEFAULT false,last_scan timestamptz,
 PRIMARY KEY(corp_id,user_id)
);
CREATE TABLE knowledge_dependencies (
 corp_id text NOT NULL,user_id text NOT NULL,surface_id text NOT NULL,task_id text NOT NULL,
 node_id text NOT NULL,version_id text NOT NULL,invalidated_at timestamptz,
 PRIMARY KEY(corp_id,user_id,surface_id,task_id,node_id)
);
CREATE INDEX knowledge_resources_scope ON knowledge_resources(corp_id,user_id,workspace_id,status);
