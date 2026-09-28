ALTER TABLE conversation_surfaces
  ADD COLUMN IF NOT EXISTS context_reset_at timestamptz NOT NULL DEFAULT now();
