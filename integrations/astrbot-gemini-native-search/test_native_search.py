"""Protocol regressions; run with Python + httpx, without AstrBot installed."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

import httpx


def identity_decorator(*args, **kwargs):
    return lambda obj: obj


class Star:
    def __init__(self, context):
        self.context = context


sys.modules["astrbot"] = types.ModuleType("astrbot")
sys.modules["astrbot.api"] = types.ModuleType("astrbot.api")
event_api = types.ModuleType("astrbot.api.event")
event_api.AstrMessageEvent = object
event_api.filter = types.SimpleNamespace(llm_tool=identity_decorator)
sys.modules[event_api.__name__] = event_api
star_api = types.ModuleType("astrbot.api.star")
star_api.Context = object
star_api.Star = Star
star_api.register = identity_decorator
sys.modules[star_api.__name__] = star_api
spec = importlib.util.spec_from_file_location("native_search", Path(__file__).with_name("main.py"))
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def provider():
    return types.SimpleNamespace(
        provider_config={"api_base": "http://upstream/antigravity", "key": ["WRONG_CONFIG_KEY"]},
        get_model=lambda: "gemini-3.8-flash-high",
        get_current_key=lambda: "CURRENT_SESSION_KEY",
    )


def grounded_response():
    return httpx.Response(200, json={
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "Grounded fact", "annotations": [{"type": "url_citation", "url": "https://example.com/source", "title": "Source"}]}]}],
    })


class SearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_native_tool_and_query_are_sent_using_current_key(self):
        client = AsyncMock()
        client.post.return_value = grounded_response()
        with patch.object(plugin.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            result = await plugin.search_native(provider(), "Public test question")
        self.assertEqual(result["status"], "ok")
        args, kwargs = client.post.call_args
        self.assertEqual(args[0], "http://upstream/antigravity/v1/responses")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer CURRENT_SESSION_KEY")
        self.assertEqual(kwargs["json"]["tools"], [{"type": "web_search_preview"}])
        self.assertFalse(kwargs["json"]["stream"])
        self.assertNotIn("messages", kwargs["json"])
        self.assertNotIn("instructions", kwargs["json"])
        self.assertNotIn("CURRENT_SESSION_KEY", json.dumps(result))

    async def test_invalid_queries_and_other_models_do_not_make_requests(self):
        with patch.object(plugin.httpx, "AsyncClient") as factory:
            for query in ["", " ", "x" * 4001]:
                self.assertEqual((await plugin.search_native(provider(), query))["status"], "error")
            p = provider()
            p.get_model = lambda: "other-model"
            self.assertEqual((await plugin.search_native(p, "question"))["status"], "error")
            factory.assert_not_called()

    async def test_bounded_retry_for_transient_http_failure(self):
        client = AsyncMock()
        client.post.side_effect = [httpx.Response(503), httpx.Response(503)]
        with patch.object(plugin.httpx, "AsyncClient") as factory, patch.object(plugin.asyncio, "sleep", new_callable=AsyncMock):
            factory.return_value.__aenter__.return_value = client
            result = await plugin.search_native(provider(), "question")
        self.assertEqual(result["status"], "error")
        self.assertEqual(client.post.call_count, 2)

    async def test_incomplete_response_is_retried_once_then_returns_error(self):
        client = AsyncMock()
        client.post.return_value = httpx.Response(200, json={"status": "incomplete", "output": []})
        with patch.object(plugin.httpx, "AsyncClient") as factory, patch.object(plugin.asyncio, "sleep", new_callable=AsyncMock):
            factory.return_value.__aenter__.return_value = client
            result = await plugin.search_native(provider(), "question")
        self.assertEqual(result["status"], "error")
        self.assertEqual(client.post.call_count, 2)

    async def test_http_400_does_not_retry_or_expose_upstream_error_body(self):
        client = AsyncMock()
        client.post.return_value = httpx.Response(400, json={"error": "SENSITIVE_DIAGNOSTIC"})
        with patch.object(plugin.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            result = await plugin.search_native(provider(), "question")
        self.assertEqual(client.post.call_count, 1)
        self.assertNotIn("SENSITIVE_DIAGNOSTIC", json.dumps(result))

    async def test_tool_resolves_provider_for_original_conversation(self):
        p = provider()
        context = types.SimpleNamespace(get_using_provider_async=AsyncMock(return_value=p))
        event = types.SimpleNamespace(unified_msg_origin="original-session")
        with patch.object(plugin, "search_native", new_callable=AsyncMock, return_value={"status": "ok"}) as search:
            await plugin.GeminiNativeSearch(context).gemini_web_search(event, "public question")
        context.get_using_provider_async.assert_awaited_once_with("original-session")
        search.assert_awaited_once_with(p, "public question")


class ParsingTests(unittest.TestCase):
    def test_plain_urls_do_not_prove_native_grounding(self):
        result = plugin.extract_grounding({"status": "completed", "output_text": "Claim https://example.com"})
        self.assertEqual(result["status"], "unverified")

    def test_compatibility_grounding_metadata_is_recognized(self):
        result = plugin.extract_grounding({"status": "completed", "output_text": "Fact\nWeb search queries: test\nSources: https://vertexaisearch.cloud.google.com/grounding-api-redirect/test"})
        self.assertEqual(result["status"], "ok")

    def test_empty_failed_and_incomplete_outputs_are_rejected(self):
        for data in [{"status": "completed", "output": []}, {"status": "failed"}, {"status": "incomplete", "output_text": "Partial"}, {"error": {"message": "error"}}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                plugin.extract_grounding(data)

    def test_url_normalization_preserves_route_prefix(self):
        self.assertEqual(plugin.responses_url("http://x/antigravity/"), "http://x/antigravity/v1/responses")
        self.assertEqual(plugin.responses_url("http://x/antigravity/v1/"), "http://x/antigravity/v1/responses")
        self.assertEqual(plugin.responses_url("http://x/antigravity/v1/responses"), "http://x/antigravity/v1/responses")


if __name__ == "__main__":
    unittest.main()
