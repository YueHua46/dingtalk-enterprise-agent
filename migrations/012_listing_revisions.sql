-- Host-owned listing drafts only. No approval state or Amazon writes.
CREATE TABLE IF NOT EXISTS listing_revision_sessions (
  corp_id TEXT NOT NULL, user_id TEXT NOT NULL,
  surface_type TEXT NOT NULL CHECK (surface_type IN ('direct','group')),
  surface_id TEXT NOT NULL, request_id TEXT NOT NULL, head_id TEXT,
  PRIMARY KEY(corp_id,user_id,surface_type,surface_id,request_id)
);
CREATE TABLE IF NOT EXISTS listing_revision_operations (
  corp_id TEXT NOT NULL, user_id TEXT NOT NULL, surface_type TEXT NOT NULL,
  surface_id TEXT NOT NULL, request_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, base_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','completed')),
  result_text TEXT,
  PRIMARY KEY(corp_id,user_id,surface_type,surface_id,request_id,operation_id),
  FOREIGN KEY(corp_id,user_id,surface_type,surface_id,request_id)
    REFERENCES listing_revision_sessions(corp_id,user_id,surface_type,surface_id,request_id)
);
CREATE TABLE IF NOT EXISTS listing_revision_versions (
  corp_id TEXT NOT NULL, user_id TEXT NOT NULL, surface_type TEXT NOT NULL,
  surface_id TEXT NOT NULL, request_id TEXT NOT NULL, version_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0), parent_id TEXT, operation_id TEXT NOT NULL,
  -- TEXT preserves JSON property order for existing module 6/7 SHA-256 receipts.
  payload_text TEXT NOT NULL,
  PRIMARY KEY(corp_id,user_id,surface_type,surface_id,request_id,version_id),
  UNIQUE(corp_id,user_id,surface_type,surface_id,request_id,ordinal),
  FOREIGN KEY(corp_id,user_id,surface_type,surface_id,request_id,operation_id)
    REFERENCES listing_revision_operations(corp_id,user_id,surface_type,surface_id,request_id,operation_id)
);
