ALTER TABLE tasks ADD COLUMN IF NOT EXISTS request_payload JSONB;
UPDATE tasks
SET request_payload = jsonb_build_object(
  'requestId', id::text,
  'messageId', id::text,
  'user', jsonb_build_object('corpId', corp_id, 'userId', user_id),
  'surface', jsonb_build_object('type', 'direct', 'id', user_id),
  'text', input_text,
  'attachments', '[]'::jsonb,
  'receivedAt', (extract(epoch FROM created_at) * 1000)::bigint
)
WHERE request_payload IS NULL;
ALTER TABLE tasks ALTER COLUMN request_payload SET NOT NULL;

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS action_payload JSONB;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
UPDATE approvals SET action_payload=jsonb_build_object('name',action_type,'risk','write','target',target_summary), method='business' WHERE action_payload IS NULL OR method IS NULL;
ALTER TABLE approvals ALTER COLUMN action_payload SET NOT NULL;
ALTER TABLE approvals ALTER COLUMN method SET NOT NULL;

CREATE TABLE IF NOT EXISTS tool_invocations (
  idempotency_key TEXT PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id),
  action_hash TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed','unknown')),
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS approvals_active_task_idx ON approvals(task_id) WHERE status IN ('pending','approved');
