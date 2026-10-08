-- JSONB normalizes object key order. Preserve the original serialized snapshot for
-- existing byte-based integrity checks, as already done by listing revision storage.
ALTER TABLE listing_tool_sessions ADD COLUMN IF NOT EXISTS payload_text text;
-- Legacy JSONB-only sessions cannot prove the original serialization. They must be
-- prepared again rather than silently authorizing changed facts or stored hashes.
