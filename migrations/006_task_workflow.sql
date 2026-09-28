ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('queued','running','waiting_oauth','waiting_confirmation','waiting_clarification','completed','cancelled','failed'));

CREATE TABLE IF NOT EXISTS task_workflows (
  task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_workflows_updated_idx ON task_workflows(updated_at);
