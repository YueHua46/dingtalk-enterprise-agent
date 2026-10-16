ALTER TABLE tasks ADD COLUMN IF NOT EXISTS clarification_card_biz_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_clarification_card_idx ON tasks(clarification_card_biz_id) WHERE clarification_card_biz_id IS NOT NULL;
