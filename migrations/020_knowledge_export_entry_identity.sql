-- Shortcut targets can be outside the scanned wiki. Keep source node IDs for
-- job deduplication while tying lifecycle to the indexed employee entry.
ALTER TABLE knowledge_exports ADD COLUMN entry_node_id text;
ALTER TABLE knowledge_sheet_exports ADD COLUMN entry_node_id text;
UPDATE knowledge_exports SET entry_node_id=node_id;
UPDATE knowledge_sheet_exports SET entry_node_id=node_id;
CREATE FUNCTION knowledge_export_entry_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.entry_node_id=COALESCE(NEW.entry_node_id,NEW.node_id);
 RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_exports_entry BEFORE INSERT OR UPDATE ON knowledge_exports
 FOR EACH ROW EXECUTE FUNCTION knowledge_export_entry_identity();
CREATE TRIGGER knowledge_sheet_exports_entry BEFORE INSERT OR UPDATE ON knowledge_sheet_exports
 FOR EACH ROW EXECUTE FUNCTION knowledge_export_entry_identity();
ALTER TABLE knowledge_exports ALTER COLUMN entry_node_id SET NOT NULL;
ALTER TABLE knowledge_sheet_exports ALTER COLUMN entry_node_id SET NOT NULL;
ALTER TABLE knowledge_exports DROP CONSTRAINT knowledge_exports_corp_id_user_id_node_id_fkey;
ALTER TABLE knowledge_sheet_exports DROP CONSTRAINT knowledge_sheet_exports_corp_id_user_id_node_id_fkey;
ALTER TABLE knowledge_exports ADD FOREIGN KEY(corp_id,user_id,entry_node_id) REFERENCES knowledge_resources ON DELETE CASCADE;
ALTER TABLE knowledge_sheet_exports ADD FOREIGN KEY(corp_id,user_id,entry_node_id) REFERENCES knowledge_resources ON DELETE CASCADE;
