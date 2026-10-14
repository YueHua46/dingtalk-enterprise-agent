# Gemini native web search

This plugin exposes gemini_web_search as a normal AstrBot function tool. It uses the active conversation provider and key, issuing an isolated /v1/responses request with only web_search_preview. The main Anthropic provider and existing tools remain available.

Version 1.1 also performs native search before generation when the current message explicitly asks for a current/latest public fact such as a software/game version, release, news, weather, exchange rate, or score. It appends dated verification instructions to the existing persona and adds untrusted source evidence to the request. This closes the gap where simply registering a search tool allowed the model to answer current questions from memory. The hook runs after the current AstrBot main-agent persona construction and other installed request hooks (priority -1000000); it does not replace the tool manager or persona text.

Automatic detection is intentionally bounded: at most 500 characters, explicit freshness and public-topic terms, and no messages containing common secret/private-data markers. Other queries can still use `gemini_web_search`. Only the current eligible question goes to search, without chat history or persona. If grounding fails, the model is instructed to disclose the inability to verify rather than invent a latest version. This is not a universal natural-language intent classifier.

Installed and loaded 2026-10-14 (+08). Live tests: native grounding returned Google Vertex search redirect sources; Anthropic called gemini_web_search and, after actual search results were returned, successfully called the existing aiimg_task_status schema (HTTP 200 both steps). No business tool was executed during the probe.

The same live path passed after the Sub2API stream patch was deployed: native search returned 15 grounding sources and the next model turn selected `aiimg_task_status`, with HTTP 200 on both model turns and 28.88 seconds overall. This verifies search and existing tool selection; QQ message delivery was not tested.

The original AstrBot web_search setting stays false because this plugin implements native search separately. No provider configuration changes are required. All current personas have tools=null and plugin_set=[*], so the registered tool is included automatically.

To disable: disable this plugin in AstrBot plugin management. To update: replace main.py and reload this plugin. A container restart was used for the initial install.

Only public search queries are sent; the function does not send full chat history. It checks semantic completion, includes bounded read-only retries, returns source URLs, and marks ungrounded results as unverified.
