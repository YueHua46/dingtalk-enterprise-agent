"""Read-only DingTalk directory sync using the configured robot credentials."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from config.settings import (
    DINGTALK_CORP_ID,
    DINGTALK_DIRECTORY_APP_KEY,
    DINGTALK_DIRECTORY_APP_SECRET,
    DINGTALK_DIRECTORY_FACTORY_DEPT_ID,
)
from database.models.dingtalk_directory import DingTalkDirectory
from services.dingtalk_config_service import DingTalkConfigService


class DingTalkDirectoryService:
    def __init__(self, model: DingTalkDirectory | None = None) -> None:
        self.model = model or DingTalkDirectory()
        self._config = DingTalkConfigService()

    @property
    def is_available(self) -> bool:
        return self.model.is_configured

    def sync(self, corp_id: str | None = None) -> dict[str, Any]:
        corp = str(corp_id or DINGTALK_CORP_ID or "").strip()
        if not corp:
            raise ValueError("请配置 DINGTALK_CORP_ID，或在同步请求中传入 corp_id")
        cfg = self._config.resolve_runtime_config()
        app_key = DINGTALK_DIRECTORY_APP_KEY or cfg.app_key
        app_secret = DINGTALK_DIRECTORY_APP_SECRET or cfg.app_secret
        if not app_key or not app_secret:
            raise RuntimeError("钉钉机器人凭证未配置或未启用")
        token = self._access_token(app_key, app_secret)
        departments = self._department_tree(token)
        factory_id = DINGTALK_DIRECTORY_FACTORY_DEPT_ID
        if factory_id and factory_id not in departments:
            raise RuntimeError("工厂部门不可见，请检查通讯录权限")
        excluded = self._descendants(departments, factory_id) if factory_id else set()
        candidates: dict[str, dict[str, Any]] = {}
        excluded_users: set[str] = set()
        for dept_id, (parent_id, dept_name) in departments.items():
            for member in self._department_members(token, dept_id):
                user_id = str(member.get("userid") or member.get("userId") or "").strip()
                name = str(member.get("name") or "").strip()
                if not user_id or not name:
                    continue
                if dept_id in excluded:
                    excluded_users.add(user_id)
                    continue
                item = candidates.setdefault(user_id, {"user_id": user_id, "display_name": name, "department_ids": [], "department_names": []})
                if dept_id not in item["department_ids"]:
                    item["department_ids"].append(dept_id)
                if dept_name and dept_name not in item["department_names"]:
                    item["department_names"].append(dept_name)
        rows = [value for key, value in candidates.items() if key not in excluded_users]
        rows.sort(key=lambda value: (value["display_name"], value["user_id"]))
        self.model.create_table()
        count = self.model.replace_users(corp, rows)
        return {"corp_id": corp, "count": count, "excluded_factory_users": len(excluded_users)}

    def candidates(self, corp_id: str | None = None) -> list[dict[str, Any]]:
        self.model.create_table()
        return self.model.list_users(corp_id)

    def ensure_recent(self, corp_id: str, max_age: timedelta = timedelta(minutes=15)) -> None:
        """Refresh before authorizing if cached membership is stale; errors fail closed."""
        self.model.create_table()
        last = self.model.last_synced_at(corp_id)
        if last is None or last.tzinfo is None or datetime.now(timezone.utc) - last > max_age:
            self.sync(corp_id)

    def _access_token(self, app_key: str, app_secret: str) -> str:
        body = json.dumps({"appKey": app_key, "appSecret": app_secret}).encode("utf-8")
        req = urllib.request.Request("https://api.dingtalk.com/v1.0/oauth2/accessToken", data=body, headers={"content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
        token = str(payload.get("accessToken") or "").strip()
        if not token:
            raise RuntimeError("钉钉 accessToken 获取失败")
        return token

    def _post(self, token: str, path: str, body: dict[str, Any]) -> Any:
        query = urlencode({"access_token": token})
        req = urllib.request.Request("https://oapi.dingtalk.com/topapi/" + path + "?" + query, data=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=20) as response:
                    payload = json.loads(response.read().decode("utf-8", "replace"))
            except urllib.error.HTTPError as exc:
                if exc.code in {429, 500, 502, 503, 504} and attempt < 2:
                    time.sleep(0.4 * (2 ** attempt))
                    continue
                raise RuntimeError(f"钉钉通讯录接口失败（HTTP {exc.code}）") from exc
            code = int(payload.get("errcode") or 0)
            if code == 0:
                return payload.get("result") or {}
            subcode = payload.get("sub_code") or payload.get("subCode")
            if (code == -1 or (code == 88 and not subcode)) and attempt < 2:
                time.sleep(0.4 * (2 ** attempt))
                continue
            raise RuntimeError(f"钉钉通讯录接口失败（{code}{'/' + str(subcode) if subcode else ''}）")
        raise RuntimeError("钉钉通讯录接口重试后仍失败")

    def _department_tree(self, token: str) -> dict[int, tuple[int | None, str]]:
        departments: dict[int, tuple[int | None, str]] = {1: (None, "根部门")}
        queue = [1]
        while queue and len(departments) < 500:
            parent = queue.pop(0)
            result = self._post(token, "v2/department/listsub", {"dept_id": parent, "language": "zh_CN"})
            rows = result if isinstance(result, list) else result.get("list", [])
            for row in rows or []:
                dept_id = int(row.get("dept_id") or row.get("deptId") or 0)
                if dept_id > 0 and dept_id not in departments:
                    departments[dept_id] = (parent, str(row.get("name") or dept_id))
                    queue.append(dept_id)
        if queue:
            raise RuntimeError("钉钉部门数量超过同步上限，已保留原通讯录缓存")
        return departments

    def _department_members(self, token: str, dept_id: int) -> list[dict[str, Any]]:
        members: list[dict[str, Any]] = []
        cursor = 0
        for _ in range(200):
            result = self._post(token, "v2/user/list", {"dept_id": dept_id, "cursor": cursor, "size": 100})
            rows = result.get("list", []) if isinstance(result, dict) else []
            members.extend(rows or [])
            if not result.get("has_more"):
                return members
            next_cursor = int(result.get("next_cursor") or 0)
            if next_cursor <= cursor:
                raise RuntimeError("钉钉成员分页游标异常，已保留原通讯录缓存")
            cursor = next_cursor
        raise RuntimeError("钉钉成员数量超过同步上限，已保留原通讯录缓存")

    @staticmethod
    def _descendants(departments: dict[int, tuple[int | None, str]], root_id: int) -> set[int]:
        if not root_id:
            return set()
        excluded = {root_id}
        changed = True
        while changed:
            changed = False
            for dept_id, (parent_id, _name) in departments.items():
                if parent_id in excluded and dept_id not in excluded:
                    excluded.add(dept_id)
                    changed = True
        return excluded
