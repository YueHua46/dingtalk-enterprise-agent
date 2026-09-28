"""DDL for the cached DingTalk directory used by Agent data grants."""

T_DINGTALK_DIRECTORY_USER = "cbops_sys_dingtalk_directory_user"
T_AGENT_DATA_GRANT = "cbops_sys_agent_data_grant"
T_AGENT_DATA_GRANT_STORE = "cbops_sys_agent_data_grant_store"
T_AGENT_DATA_GRANT_AUDIT = "cbops_sys_agent_data_grant_audit"

CREATE_DINGTALK_DIRECTORY_SQL = f"""
CREATE TABLE IF NOT EXISTS {T_DINGTALK_DIRECTORY_USER} (
    id BIGSERIAL PRIMARY KEY,
    corp_id VARCHAR(128) NOT NULL,
    user_id VARCHAR(256) NOT NULL,
    display_name VARCHAR(256) NOT NULL,
    department_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    department_names JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active SMALLINT NOT NULL DEFAULT 1,
    source_updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (corp_id, user_id),
    CONSTRAINT chk_dingtalk_directory_active CHECK (is_active IN (0, 1))
)
"""

CREATE_AGENT_DATA_GRANT_SQL = f"""
CREATE TABLE IF NOT EXISTS {T_AGENT_DATA_GRANT} (
    id BIGSERIAL PRIMARY KEY,
    corp_id VARCHAR(128) NOT NULL,
    dingtalk_user_id VARCHAR(256) NOT NULL,
    source_app_user_id BIGINT NULL REFERENCES cbops_sys_user_base(id) ON DELETE CASCADE,
    scope_type VARCHAR(32) NOT NULL,
    is_active SMALLINT NOT NULL DEFAULT 1,
    created_by BIGINT NULL REFERENCES cbops_sys_user_base(id) ON DELETE SET NULL,
    updated_by BIGINT NULL REFERENCES cbops_sys_user_base(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_data_grant_scope CHECK (scope_type IN ('source_account', 'selected_stores')),
    CONSTRAINT chk_agent_data_grant_active CHECK (is_active IN (0, 1))
)
"""

CREATE_AGENT_DATA_GRANT_STORE_SQL = f"""
CREATE TABLE IF NOT EXISTS {T_AGENT_DATA_GRANT_STORE} (
    grant_id BIGINT NOT NULL REFERENCES {T_AGENT_DATA_GRANT}(id) ON DELETE CASCADE,
    store_id BIGINT NOT NULL REFERENCES cbops_sys_store_catalog(id) ON DELETE CASCADE,
    PRIMARY KEY (grant_id, store_id)
)
"""

CREATE_AGENT_DATA_GRANT_AUDIT_SQL = f"""
CREATE TABLE IF NOT EXISTS {T_AGENT_DATA_GRANT_AUDIT} (
    id BIGSERIAL PRIMARY KEY,
    grant_id BIGINT NULL,
    operation VARCHAR(16) NOT NULL,
    actor_id BIGINT NULL,
    corp_id VARCHAR(128) NOT NULL,
    dingtalk_user_id VARCHAR(256) NOT NULL,
    old_mapping JSONB NULL,
    new_mapping JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""

INDEX_SQLS = (
    f"CREATE INDEX IF NOT EXISTS idx_dingtalk_directory_corp_active ON {T_DINGTALK_DIRECTORY_USER} (corp_id, is_active, display_name);",
    f"CREATE INDEX IF NOT EXISTS idx_agent_data_grant_user ON {T_AGENT_DATA_GRANT} (corp_id, dingtalk_user_id, is_active);",
    f"CREATE INDEX IF NOT EXISTS idx_agent_data_grant_source ON {T_AGENT_DATA_GRANT} (source_app_user_id, is_active);",
    f"CREATE INDEX IF NOT EXISTS idx_agent_data_grant_store_store ON {T_AGENT_DATA_GRANT_STORE} (store_id);",
    f"CREATE INDEX IF NOT EXISTS idx_agent_data_grant_audit_grant ON {T_AGENT_DATA_GRANT_AUDIT} (grant_id, created_at DESC);",
)
