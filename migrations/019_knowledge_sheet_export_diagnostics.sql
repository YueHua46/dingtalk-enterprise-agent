-- An actual returned job can be queried without submitting another export.
ALTER TABLE knowledge_sheet_exports
 ADD COLUMN source_hash text,
 ADD COLUMN stage text,
 ADD COLUMN diagnostic jsonb;
ALTER TABLE knowledge_sheet_exports ADD CHECK(source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$');
