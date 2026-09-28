ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS result_visibility text NOT NULL DEFAULT 'unknown';

ALTER TABLE tasks
  ADD CONSTRAINT tasks_result_visibility_check
  CHECK (result_visibility IN ('unknown', 'surface', 'private'));
