-- Persistent provider refusals survive parser upgrades and process restarts.
-- No input text or provider response body is retained. Source/model changes
-- do not implicitly authorize retrying a refusal that has not been resolved.
CREATE TABLE knowledge_embedding_rejections (
 corp_id text NOT NULL, user_id text NOT NULL, node_id text NOT NULL,
 embedding_model text, input_hash text,
 provider_code text, provider_request_id text,
 rejected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(corp_id,user_id,node_id),
 CHECK(input_hash IS NULL OR input_hash ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(corp_id,user_id,node_id) REFERENCES knowledge_resources ON DELETE CASCADE
);
