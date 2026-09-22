CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  corp_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  dws_profile_key TEXT,
  dws_authenticated_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (corp_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_surfaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  surface_type TEXT NOT NULL CHECK (surface_type IN ('direct', 'group')),
  surface_id TEXT NOT NULL,
  codex_thread_id TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (corp_id, user_id, surface_type, surface_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  surface_id UUID NOT NULL REFERENCES conversation_surfaces(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_oauth','waiting_confirmation','completed','cancelled','failed')),
  input_text TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  codex_thread_id TEXT,
  confirmation_hash TEXT,
  error_code TEXT,
  result_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tasks_user_created_idx ON tasks(corp_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value JSONB NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive','secret')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (corp_id, user_id, memory_key)
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  corp_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_summary TEXT NOT NULL,
  parameter_hash TEXT NOT NULL,
  action_payload JSONB NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled','expired','executed')),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS approvals_active_task_idx ON approvals(task_id) WHERE status IN ('pending','approved');

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

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  task_id UUID,
  corp_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  surface_id TEXT,
  event_type TEXT NOT NULL,
  risk_level TEXT,
  tool_name TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_user_created_idx ON audit_events(corp_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inbox_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
