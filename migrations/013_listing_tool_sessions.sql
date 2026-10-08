CREATE TABLE IF NOT EXISTS listing_tool_sessions (
  corp_id text NOT NULL, user_id text NOT NULL, surface_type text NOT NULL,
  surface_id text NOT NULL, session_id text NOT NULL, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(corp_id,user_id,surface_type,surface_id,session_id)
);
