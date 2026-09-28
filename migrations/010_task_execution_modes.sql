CREATE TABLE IF NOT EXISTS task_execution_modes (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('local', 'worker')),
  created_at timestamptz NOT NULL DEFAULT now()
);
