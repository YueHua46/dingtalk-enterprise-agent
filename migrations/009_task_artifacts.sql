CREATE TABLE IF NOT EXISTS task_artifacts (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  name text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, sha256, name)
);
