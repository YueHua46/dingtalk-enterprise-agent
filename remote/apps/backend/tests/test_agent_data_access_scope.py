from datetime import date, datetime, timedelta, timezone
import json
from types import SimpleNamespace

import pytest

from api.agent_access_routes import _ads_query
from database.models.dingtalk_directory import AgentDataGrant
from services.dingtalk_directory_service import DingTalkDirectoryService


def test_effective_scope_requires_active_dingtalk_directory_member(monkeypatch):
    model = AgentDataGrant()
    captured = []

    def fetch_all(sql, params):
        captured.append((sql, params))
        return []

    monkeypatch.setattr(model, "fetch_all", fetch_all)
    assert model.effective_scope("corp", "user")["has_access"] is False
    sql, params = captured[0]
    assert "du.corp_id=g.corp_id" in sql
    assert "du.user_id=g.dingtalk_user_id AND du.is_active=1" in sql
    assert "au.role IN ('superuser', 'admin') OR us.store_id=s.id" in sql
    assert params == ("corp", "user")


def test_source_account_preview_inherits_global_role_store_scope(monkeypatch):
    import database.models.dingtalk_directory as directory_module

    model = AgentDataGrant()
    monkeypatch.setattr(directory_module.DingTalkDirectory, "get_user", lambda *_args: {"is_active": 1})
    monkeypatch.setattr(model, "fetch_one", lambda *_args: {"id": 1, "role": "superuser"})
    queried = []

    def fetch_all(sql, params=None):
        queried.append(sql)
        return [{"id": 4, "lingxing_sid": 44}]

    monkeypatch.setattr(model, "fetch_all", fetch_all)
    monkeypatch.setattr(model, "effective_scope", lambda *_args: {"stores": [], "store_ids": [], "lingxing_sids": []})
    preview = model.preview_new_grant(corp_id="corp", dingtalk_user_id="user", scope_type="source_account", source_app_user_id=1, store_ids=[])
    assert preview["store_ids"] == [4]
    assert "FROM" in queried[0] and "WHERE is_available=1 AND collection_enabled" in queried[0]
    assert "JOIN" not in queried[0]


def test_directory_refreshes_stale_cache_and_fails_closed(monkeypatch):
    model = SimpleNamespace(
        create_table=lambda: True,
        last_synced_at=lambda corp_id: datetime.now(timezone.utc) - timedelta(hours=1),
    )
    service = DingTalkDirectoryService(model)
    calls = []
    monkeypatch.setattr(service, "sync", lambda corp_id: calls.append(corp_id))
    service.ensure_recent("corp")
    assert calls == ["corp"]

    def fail(_corp_id):
        raise RuntimeError("DingTalk unavailable")

    monkeypatch.setattr(service, "sync", fail)
    with pytest.raises(RuntimeError, match="DingTalk unavailable"):
        service.ensure_recent("corp")


def test_dingtalk_transient_88_without_subcode_is_retried(monkeypatch):
    import services.dingtalk_directory_service as directory_module

    attempts = iter([{"errcode": 88, "errmsg": "ding talk error"}, {"errcode": 0, "result": []}])
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(next(attempts)).encode()

    monkeypatch.setattr(directory_module.urllib.request, "urlopen", lambda *_args, **_kwargs: calls.append(1) or Response())
    monkeypatch.setattr(directory_module.time, "sleep", lambda *_args: None)
    service = DingTalkDirectoryService(SimpleNamespace())
    assert service._post("opaque-token", "v2/department/listsub", {"dept_id": 1}) == {}
    assert len(calls) == 2


def test_ads_page_offset_is_applied_after_merging_stores(monkeypatch):
    import database.database as database_module
    import services.daily_data_availability as availability_module

    class Reports:
        def list_sp_search_terms(self, *, sid, limit, offset, **_kwargs):
            assert offset == 0
            assert limit == 3
            rows = [
                {"id": sid * 10 + index, "sid": sid, "report_date": "2026-09-24", "spend": 10 - index}
                for index in range(2)
            ]
            return rows, 2

    monkeypatch.setattr(database_module, "Database", lambda: SimpleNamespace(ad_reports=Reports()))
    monkeypatch.setattr(availability_module, "default_daily_end_date", lambda *_args, **_kwargs: date(2026, 9, 24))
    page = _ads_query("ads.sp_search_terms", {"limit": 2, "offset": 1}, [1, 2])
    assert page["total"] == 4
    assert len(page["rows"]) == 2
    assert [row["spend"] for row in page["rows"]] == [10, 9]
    assert page["coverage"] == {
        "mode": "page",
        "basis": "ordered_rows",
        "total": 4,
        "offset": 1,
        "returned": 2,
        "limit": 2,
        "has_more": True,
        "next_offset": 3,
    }
