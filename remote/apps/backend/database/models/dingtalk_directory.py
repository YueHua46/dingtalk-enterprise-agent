"""Cached DingTalk users and generic Agent store grants."""

from __future__ import annotations

import json
from typing import Any, Iterable

from psycopg2.extras import DictCursor, Json, execute_values

from .app_user_sql import T_APP_USER
from .base import BaseModel
from .dingtalk_directory_sql import (
    CREATE_AGENT_DATA_GRANT_SQL,
    CREATE_AGENT_DATA_GRANT_AUDIT_SQL,
    CREATE_AGENT_DATA_GRANT_STORE_SQL,
    CREATE_DINGTALK_DIRECTORY_SQL,
    INDEX_SQLS,
    T_AGENT_DATA_GRANT,
    T_AGENT_DATA_GRANT_STORE,
    T_AGENT_DATA_GRANT_AUDIT,
    T_DINGTALK_DIRECTORY_USER,
)
from .store_access_sql import T_STORE, T_USER_STORE


class DingTalkDirectory(BaseModel):
    CREATE_TABLE_SQL = CREATE_DINGTALK_DIRECTORY_SQL

    def create_table(self) -> bool:
        if not self.is_configured:
            return False
        self.execute_sql(CREATE_DINGTALK_DIRECTORY_SQL)
        self.execute_sql(CREATE_AGENT_DATA_GRANT_SQL)
        self.execute_sql(CREATE_AGENT_DATA_GRANT_STORE_SQL)
        self.execute_sql(CREATE_AGENT_DATA_GRANT_AUDIT_SQL)
        for sql in INDEX_SQLS:
            self.execute_sql(sql)
        return True

    def replace_users(self, corp_id: str, users: Iterable[dict[str, Any]]) -> int:
        rows = []
        for user in users:
            user_id = str(user.get("user_id") or "").strip()
            name = str(user.get("display_name") or "").strip()
            if not user_id or not name:
                continue
            rows.append((
                corp_id,
                user_id,
                name,
                Json(sorted({int(value) for value in (user.get("department_ids") or [])})),
                Json([str(value) for value in (user.get("department_names") or []) if str(value).strip()]),
            ))
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {T_DINGTALK_DIRECTORY_USER} SET is_active=0, last_synced_at=CURRENT_TIMESTAMP WHERE corp_id=%s",
                    (corp_id,),
                )
                if rows:
                    execute_values(
                        cur,
                        f"""
                        INSERT INTO {T_DINGTALK_DIRECTORY_USER}
                            (corp_id, user_id, display_name, department_ids, department_names,
                             is_active, source_updated_at, last_synced_at)
                        VALUES %s
                        ON CONFLICT (corp_id, user_id) DO UPDATE SET
                            display_name=EXCLUDED.display_name,
                            department_ids=EXCLUDED.department_ids,
                            department_names=EXCLUDED.department_names,
                            is_active=1,
                            source_updated_at=CURRENT_TIMESTAMP,
                            last_synced_at=CURRENT_TIMESTAMP
                        """,
                        rows,
                        template="(%s,%s,%s,%s,%s,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                    )
            conn.commit()
        return len(rows)

    def list_users(self, corp_id: str | None = None, *, active_only: bool = True) -> list[dict[str, Any]]:
        clauses = []
        params: list[Any] = []
        if corp_id:
            clauses.append("corp_id=%s")
            params.append(corp_id)
        if active_only:
            clauses.append("is_active=1")
        where = "WHERE " + " AND ".join(clauses) if clauses else ""
        rows = self.fetch_all(
            f"""
            SELECT corp_id, user_id, display_name, department_ids, department_names,
                   is_active, source_updated_at, last_synced_at
            FROM {T_DINGTALK_DIRECTORY_USER}
            {where}
            ORDER BY display_name, user_id
            """,
            tuple(params),
        ) or []
        return [dict(row) for row in rows]

    def get_user(self, corp_id: str, user_id: str) -> dict[str, Any] | None:
        row = self.fetch_one(
            f"SELECT corp_id, user_id, display_name, is_active FROM {T_DINGTALK_DIRECTORY_USER} WHERE corp_id=%s AND user_id=%s",
            (corp_id, user_id),
        )
        return dict(row) if row else None

    def last_synced_at(self, corp_id: str):
        row = self.fetch_one(
            f"SELECT MAX(last_synced_at) FROM {T_DINGTALK_DIRECTORY_USER} WHERE corp_id=%s",
            (corp_id,),
        )
        return row[0] if row else None


class AgentDataGrant(BaseModel):
    CREATE_TABLE_SQL = CREATE_AGENT_DATA_GRANT_SQL

    def create_table(self) -> bool:
        if not self.is_configured:
            return False
        self.execute_sql(CREATE_DINGTALK_DIRECTORY_SQL)
        self.execute_sql(CREATE_AGENT_DATA_GRANT_SQL)
        self.execute_sql(CREATE_AGENT_DATA_GRANT_STORE_SQL)
        self.execute_sql(CREATE_AGENT_DATA_GRANT_AUDIT_SQL)
        for sql in INDEX_SQLS:
            self.execute_sql(sql)
        return True

    def _grant_row(self, grant_id: int) -> dict[str, Any] | None:
        row = self.fetch_one(
            f"""
            SELECT g.id, g.corp_id, g.dingtalk_user_id, g.source_app_user_id,
                   g.scope_type, g.is_active, g.created_by, g.updated_by,
                   g.created_at, g.updated_at,
                   du.display_name AS dingtalk_display_name,
                   du.is_active AS dingtalk_user_active,
                   au.username AS source_username, au.display_name AS source_display_name,
                   au.is_active AS source_account_active
            FROM {T_AGENT_DATA_GRANT} g
            LEFT JOIN {T_DINGTALK_DIRECTORY_USER} du
              ON du.corp_id=g.corp_id AND du.user_id=g.dingtalk_user_id
            LEFT JOIN {T_APP_USER} au ON au.id=g.source_app_user_id
            WHERE g.id=%s
            """,
            (grant_id,),
        )
        if not row:
            return None
        result = dict(row)
        stores = self.fetch_all(
            f"""
            SELECT s.id, s.lingxing_sid, s.name, s.account_name, s.country, s.region, s.market,
                   s.is_available, s.collection_enabled
            FROM {T_AGENT_DATA_GRANT_STORE} gs
            JOIN {T_STORE} s ON s.id=gs.store_id
            WHERE gs.grant_id=%s
            ORDER BY s.lingxing_sid
            """,
            (grant_id,),
        ) or []
        result["stores"] = [dict(store) for store in stores]
        return result

    def list_grants(self, corp_id: str | None = None) -> list[dict[str, Any]]:
        params: tuple[Any, ...] = (corp_id,) if corp_id else ()
        where = "WHERE g.corp_id=%s" if corp_id else ""
        rows = self.fetch_all(
            f"SELECT g.id FROM {T_AGENT_DATA_GRANT} g {where} ORDER BY g.dingtalk_user_id, g.id",
            params,
        ) or []
        result = []
        for row in rows:
            grant = self._grant_row(int(row[0]))
            if grant:
                result.append(grant)
        return result

    def create_grant(
        self,
        *,
        corp_id: str,
        dingtalk_user_id: str,
        scope_type: str,
        source_app_user_id: int | None,
        store_ids: Iterable[int],
        actor_id: int | None,
    ) -> dict[str, Any]:
        normalized_ids = sorted({int(value) for value in store_ids})
        with self._connection() as conn:
            with conn.cursor(cursor_factory=DictCursor) as cur:
                cur.execute(
                    f"SELECT 1 FROM {T_DINGTALK_DIRECTORY_USER} WHERE corp_id=%s AND user_id=%s AND is_active=1",
                    (corp_id, dingtalk_user_id),
                )
                if not cur.fetchone():
                    raise ValueError("钉钉用户不存在或已停用，请先同步通讯录")
                if scope_type == "source_account":
                    cur.execute(f"SELECT id FROM {T_APP_USER} WHERE id=%s AND is_active=1", (source_app_user_id,))
                    if not cur.fetchone():
                        raise ValueError("关联账号不存在或已停用")
                    normalized_ids = []
                elif scope_type == "selected_stores":
                    if not normalized_ids:
                        raise ValueError("直接指定店铺时至少选择一个店铺")
                    cur.execute(
                        f"SELECT id FROM {T_STORE} WHERE id=ANY(%s) AND is_available=1 AND collection_enabled",
                        (normalized_ids,),
                    )
                    valid = {int(row[0]) for row in cur.fetchall()}
                    if valid != set(normalized_ids):
                        raise ValueError("包含不存在、停用或未采集的店铺")
                    source_app_user_id = None
                else:
                    raise ValueError("scope_type 只能是 source_account 或 selected_stores")
                cur.execute(
                    f"""
                    INSERT INTO {T_AGENT_DATA_GRANT}
                        (corp_id, dingtalk_user_id, source_app_user_id, scope_type, is_active, created_by, updated_by)
                    VALUES (%s,%s,%s,%s,1,%s,%s) RETURNING id
                    """,
                    (corp_id, dingtalk_user_id, source_app_user_id, scope_type, actor_id, actor_id),
                )
                grant_id = int(cur.fetchone()[0])
                if normalized_ids:
                    execute_values(
                        cur,
                        f"INSERT INTO {T_AGENT_DATA_GRANT_STORE} (grant_id, store_id) VALUES %s",
                        [(grant_id, store_id) for store_id in normalized_ids],
                        template="(%s,%s)",
                    )
                self._write_audit(
                    grant_id, "create", actor_id, corp_id, dingtalk_user_id, None,
                    {"id": grant_id, "corp_id": corp_id, "dingtalk_user_id": dingtalk_user_id,
                     "scope_type": scope_type, "source_app_user_id": source_app_user_id,
                     "store_ids": normalized_ids, "is_active": 1},
                    cursor=cur,
                )
            conn.commit()
        result = self._grant_row(grant_id) or {}
        return result

    def update_grant(self, grant_id: int, **kwargs: Any) -> dict[str, Any]:
        existing = self._grant_row(grant_id)
        if not existing:
            raise ValueError("授权映射不存在")
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {T_AGENT_DATA_GRANT_STORE} WHERE grant_id=%s", (grant_id,))
                scope_type = str(kwargs.get("scope_type") or existing["scope_type"])
                source_id = kwargs.get("source_app_user_id", existing.get("source_app_user_id"))
                store_ids = sorted({int(value) for value in (kwargs.get("store_ids") or [])})
                if scope_type == "source_account":
                    cur.execute(f"SELECT 1 FROM {T_APP_USER} WHERE id=%s AND is_active=1", (source_id,))
                    if not cur.fetchone():
                        raise ValueError("关联账号不存在或已停用")
                    store_ids = []
                elif scope_type == "selected_stores":
                    if not store_ids:
                        raise ValueError("直接指定店铺时至少选择一个店铺")
                    cur.execute(f"SELECT id FROM {T_STORE} WHERE id=ANY(%s) AND is_available=1 AND collection_enabled", (store_ids,))
                    if {int(row[0]) for row in cur.fetchall()} != set(store_ids):
                        raise ValueError("包含不存在、停用或未采集的店铺")
                    source_id = None
                else:
                    raise ValueError("scope_type 只能是 source_account 或 selected_stores")
                cur.execute(
                    f"UPDATE {T_AGENT_DATA_GRANT} SET scope_type=%s, source_app_user_id=%s, is_active=%s, updated_by=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                    (scope_type, source_id, 1 if kwargs.get("is_active", True) else 0, kwargs.get("actor_id"), grant_id),
                )
                if store_ids:
                    execute_values(cur, f"INSERT INTO {T_AGENT_DATA_GRANT_STORE} (grant_id, store_id) VALUES %s", [(grant_id, value) for value in store_ids], template="(%s,%s)")
                self._write_audit(
                    grant_id, "update", kwargs.get("actor_id"), existing["corp_id"], existing["dingtalk_user_id"], existing,
                    {"id": grant_id, "corp_id": existing["corp_id"], "dingtalk_user_id": existing["dingtalk_user_id"],
                     "scope_type": scope_type, "source_app_user_id": source_id,
                     "store_ids": store_ids, "is_active": 1 if kwargs.get("is_active", True) else 0},
                    cursor=cur,
                )
            conn.commit()
        result = self._grant_row(grant_id) or {}
        return result

    def delete_grant(self, grant_id: int, actor_id: int | None = None) -> bool:
        existing = self._grant_row(grant_id)
        if not existing:
            return False
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {T_AGENT_DATA_GRANT} WHERE id=%s RETURNING id", (grant_id,))
                row = cur.fetchone()
                if row:
                    self._write_audit(grant_id, "delete", actor_id, existing["corp_id"], existing["dingtalk_user_id"], existing, None, cursor=cur)
            conn.commit()
        return bool(row)

    def _write_audit(self, grant_id: int | None, operation: str, actor_id: int | None, corp_id: str, dingtalk_user_id: str, old_mapping: dict[str, Any] | None, new_mapping: dict[str, Any] | None, *, cursor: Any | None = None) -> None:
        old_payload = Json(json.loads(json.dumps(old_mapping, ensure_ascii=False, default=str))) if old_mapping is not None else None
        new_payload = Json(json.loads(json.dumps(new_mapping, ensure_ascii=False, default=str))) if new_mapping is not None else None
        sql = f"INSERT INTO {T_AGENT_DATA_GRANT_AUDIT} (grant_id, operation, actor_id, corp_id, dingtalk_user_id, old_mapping, new_mapping) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id"
        values = (grant_id, operation, actor_id, corp_id, dingtalk_user_id, old_payload, new_payload)
        if cursor is not None:
            cursor.execute(sql, values)
        else:
            self.fetch_one_commit(sql, values)

    def list_audits(self, corp_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        where = "WHERE corp_id=%s" if corp_id else ""
        params: tuple[Any, ...] = (corp_id, max(1, min(int(limit), 500))) if corp_id else (max(1, min(int(limit), 500)),)
        rows = self.fetch_all(f"SELECT id, grant_id, operation, actor_id, corp_id, dingtalk_user_id, old_mapping, new_mapping, created_at FROM {T_AGENT_DATA_GRANT_AUDIT} {where} ORDER BY created_at DESC, id DESC LIMIT %s", params) or []
        return [dict(row) for row in rows]

    def effective_scope(self, corp_id: str, dingtalk_user_id: str) -> dict[str, Any]:
        rows = self.fetch_all(
            f"""
            SELECT DISTINCT s.id, s.lingxing_sid, s.name, s.account_name, s.country, s.region, s.market
            FROM {T_AGENT_DATA_GRANT} g
            JOIN {T_DINGTALK_DIRECTORY_USER} du
              ON du.corp_id=g.corp_id AND du.user_id=g.dingtalk_user_id AND du.is_active=1
            LEFT JOIN {T_APP_USER} au ON au.id=g.source_app_user_id
            LEFT JOIN {T_USER_STORE} us ON g.scope_type='source_account' AND us.user_id=g.source_app_user_id
            JOIN {T_STORE} s ON (
                (g.scope_type='selected_stores' AND EXISTS (
                    SELECT 1 FROM {T_AGENT_DATA_GRANT_STORE} gs WHERE gs.grant_id=g.id AND gs.store_id=s.id
                ))
                OR (g.scope_type='source_account' AND (au.role IN ('superuser', 'admin') OR us.store_id=s.id))
            )
            WHERE g.corp_id=%s AND g.dingtalk_user_id=%s AND g.is_active=1
              AND s.is_available=1 AND s.collection_enabled
              AND (g.scope_type='selected_stores' OR (au.is_active=1))
            ORDER BY s.lingxing_sid
            """,
            (corp_id, dingtalk_user_id),
        ) or []
        stores = [dict(row) for row in rows]
        return {
            "corp_id": corp_id,
            "dingtalk_user_id": dingtalk_user_id,
            "store_ids": [int(row["id"]) for row in stores],
            "lingxing_sids": [int(row["lingxing_sid"]) for row in stores],
            "stores": stores,
            "has_access": bool(stores),
        }

    def preview_new_grant(
        self, *, corp_id: str, dingtalk_user_id: str, scope_type: str,
        source_app_user_id: int | None, store_ids: Iterable[int],
    ) -> dict[str, Any]:
        """Read-only projection of the current grants plus one proposed grant."""
        candidate = DingTalkDirectory().get_user(corp_id, dingtalk_user_id)
        if not candidate or not candidate["is_active"]:
            raise ValueError("钉钉用户不存在或已停用，请先同步通讯录")
        proposed: list[dict[str, Any]]
        if scope_type == "source_account":
            account = self.fetch_one(f"SELECT id, role FROM {T_APP_USER} WHERE id=%s AND is_active=1", (source_app_user_id,))
            if not account:
                raise ValueError("关联账号不存在或已停用")
            if account["role"] in {"superuser", "admin"}:
                rows = self.fetch_all(
                    f"""SELECT id, lingxing_sid, name, account_name, country, region, market
                        FROM {T_STORE} WHERE is_available=1 AND collection_enabled""",
                ) or []
            else:
                rows = self.fetch_all(
                    f"""SELECT s.id, s.lingxing_sid, s.name, s.account_name, s.country, s.region, s.market
                        FROM {T_USER_STORE} us JOIN {T_STORE} s ON s.id=us.store_id
                        WHERE us.user_id=%s AND s.is_available=1 AND s.collection_enabled""",
                    (source_app_user_id,),
                ) or []
            proposed = [dict(row) for row in rows]
        elif scope_type == "selected_stores":
            selected = sorted({int(value) for value in store_ids})
            if not selected:
                raise ValueError("直接指定店铺时至少选择一个店铺")
            rows = self.fetch_all(
                f"""SELECT id, lingxing_sid, name, account_name, country, region, market
                    FROM {T_STORE} WHERE id=ANY(%s) AND is_available=1 AND collection_enabled""",
                (selected,),
            ) or []
            proposed = [dict(row) for row in rows]
            if {int(row["id"]) for row in proposed} != set(selected):
                raise ValueError("包含不存在、停用或未采集的店铺")
        else:
            raise ValueError("scope_type 只能是 source_account 或 selected_stores")
        current = self.effective_scope(corp_id, dingtalk_user_id)
        merged = {int(store["id"]): store for store in current["stores"]}
        merged.update({int(store["id"]): store for store in proposed})
        stores = sorted(merged.values(), key=lambda store: (int(store["lingxing_sid"]), int(store["id"])))
        return {
            "corp_id": corp_id, "dingtalk_user_id": dingtalk_user_id,
            "store_ids": [int(store["id"]) for store in stores],
            "lingxing_sids": [int(store["lingxing_sid"]) for store in stores],
            "stores": stores, "has_access": bool(stores),
        }

    def list_source_accounts(self) -> list[dict[str, Any]]:
        rows = self.fetch_all(f"SELECT id, username, display_name, role, department_id, is_active FROM {T_APP_USER} WHERE is_active=1 ORDER BY display_name, username") or []
        return [dict(row) for row in rows]

    def list_store_options(self) -> list[dict[str, Any]]:
        rows = self.fetch_all(
            f"""
            SELECT id, lingxing_sid, name, account_name, country, region, market
            FROM {T_STORE}
            WHERE is_available=1 AND collection_enabled
            ORDER BY account_name NULLS LAST, country, name
            """
        ) or []
        return [dict(row) for row in rows]
