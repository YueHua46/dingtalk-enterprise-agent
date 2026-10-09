-- Retrieval metadata is derived from already sanitized chunks. It is not an
-- authorization field and is rebuilt whenever a version is activated.
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE knowledge_chunks c
SET search_vector = to_tsvector('simple', coalesce(c.text, '') || ' ' || coalesce(r.title, '') || ' ' || coalesce(r.path, ''))
FROM knowledge_versions v
JOIN knowledge_resources r ON r.active_version = v.id
WHERE c.version_id = v.id AND c.search_vector IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_chunks_search_vector_idx
  ON knowledge_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS knowledge_chunks_version_ordinal_idx
  ON knowledge_chunks(version_id, ordinal);
