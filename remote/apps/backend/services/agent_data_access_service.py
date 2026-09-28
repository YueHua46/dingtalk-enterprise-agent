"""Generic DingTalk user -> CrossBorderOps store authorization service."""

from __future__ import annotations

from typing import Any

from database.models.dingtalk_directory import AgentDataGrant, DingTalkDirectory
from services.dingtalk_directory_service import DingTalkDirectoryService


class AgentDataAccessService:
    def __init__(self) -> None:
        self.directory = DingTalkDirectory()
        self.grants = AgentDataGrant()
        self.directory_service = DingTalkDirectoryService(self.directory)

    @property
    def is_available(self) -> bool:
        return self.grants.is_configured

    def ensure_schema(self) -> bool:
        return self.grants.create_table()

    def options(self) -> dict[str, Any]:
        self.ensure_schema()
        return {"source_accounts": self.grants.list_source_accounts(), "stores": self.grants.list_store_options()}

    def grants_payload(self, corp_id: str | None = None) -> list[dict[str, Any]]:
        self.ensure_schema()
        return self.grants.list_grants(corp_id)

    def create(self, body: dict[str, Any], actor_id: int | None) -> dict[str, Any]:
        self.ensure_schema()
        return self.grants.create_grant(
            corp_id=str(body.get("corp_id") or "").strip(),
            dingtalk_user_id=str(body.get("dingtalk_user_id") or "").strip(),
            scope_type=str(body.get("scope_type") or "").strip(),
            source_app_user_id=int(body["source_app_user_id"]) if body.get("source_app_user_id") not in (None, "") else None,
            store_ids=body.get("store_ids") or [],
            actor_id=actor_id,
        )

    def update(self, grant_id: int, body: dict[str, Any], actor_id: int | None) -> dict[str, Any]:
        self.ensure_schema()
        return self.grants.update_grant(
            grant_id,
            scope_type=body.get("scope_type"),
            source_app_user_id=int(body["source_app_user_id"]) if body.get("source_app_user_id") not in (None, "") else None,
            store_ids=body.get("store_ids") or [],
            is_active=bool(body.get("is_active", True)),
            actor_id=actor_id,
        )

    def effective_scope(self, corp_id: str, user_id: str) -> dict[str, Any]:
        self.ensure_schema()
        corp_id = corp_id.strip()
        self.directory_service.ensure_recent(corp_id)
        return self.grants.effective_scope(corp_id, user_id.strip())

    def preview_new_grant(self, body: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        corp_id = str(body.get("corp_id") or "").strip()
        self.directory_service.ensure_recent(corp_id)
        return self.grants.preview_new_grant(
            corp_id=corp_id,
            dingtalk_user_id=str(body.get("dingtalk_user_id") or "").strip(),
            scope_type=str(body.get("scope_type") or "").strip(),
            source_app_user_id=int(body["source_app_user_id"]) if body.get("source_app_user_id") not in (None, "") else None,
            store_ids=body.get("store_ids") or [],
        )

    def audits(self, corp_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        self.ensure_schema()
        return self.grants.list_audits(corp_id, limit)
