ALTER TABLE knowledge_resources
  ADD COLUMN IF NOT EXISTS last_error_diagnostic jsonb;

COMMENT ON COLUMN knowledge_resources.last_error_diagnostic IS
  'Bounded, redacted DWS failure diagnostics retained for troubleshooting; never stores tokens or request payloads.';
