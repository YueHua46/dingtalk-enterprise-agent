# Gemini native web search

This plugin exposes gemini_web_search as a normal AstrBot function tool. It uses the active conversation provider and key, issuing an isolated /v1/responses request with only web_search_preview. The main Anthropic provider, persona, and existing tools remain unchanged.

Installed and loaded 2026-10-14 (+08). Live tests: native grounding returned Google Vertex search redirect sources; Anthropic called gemini_web_search and, after actual search results were returned, successfully called the existing aiimg_task_status schema (HTTP 200 both steps). No business tool was executed during the probe.

The original AstrBot web_search setting stays false because this plugin implements native search separately. No provider configuration changes are required. All current personas have tools=null and plugin_set=[*], so the registered tool is included automatically.

To disable: disable this plugin in AstrBot plugin management. To update: replace main.py and reload this plugin. A container restart was used for the initial install.

Only public search queries are sent; the function does not send full chat history. It checks semantic completion, includes bounded read-only retries, returns source URLs, and marks ungrounded results as unverified.
