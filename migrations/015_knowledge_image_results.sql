-- Recognition checkpoints are scoped to the employee and source node. They
-- never confer access: the host must freshly download/verify an image first.
CREATE TABLE knowledge_image_results (
 corp_id text NOT NULL, user_id text NOT NULL, node_id text NOT NULL,
 digest text NOT NULL, model_key text NOT NULL, text text NOT NULL,
 last_used_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(corp_id,user_id,node_id,digest,model_key),
 FOREIGN KEY(corp_id,user_id,node_id) REFERENCES knowledge_resources ON DELETE CASCADE
);
