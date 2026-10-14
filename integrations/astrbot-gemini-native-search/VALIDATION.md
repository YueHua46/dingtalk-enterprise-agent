# Deployment and verification

The `main.py`, `README.md`, `metadata.yaml`, and two verification JSON files were downloaded from the deployed plugin using SFTP. No API keys, passwords, provider configuration, or private chat content are included.

Deployed `main.py` SHA-256:

`c9128f971ee68a179f7972cdee87dd2becc336be57fbbbe61f94c3b09f5b55a6`

The remote container file and this archived file had the same hash. AstrBot registered `gemini_web_search` at 2026-10-14 12:27:35 (+08) and reported `AstrBot started` at 12:27:38. The existing `aiimg_task_status` was also registered.

Real API checks used the existing AstrBot provider configuration and credential internally:

- Isolated native search returned `Web search queries` and Google Vertex grounding redirect sources.
- A Responses request combining native search and a normal function returned HTTP 200. The current route does not universally reject mixed tools.
- The main Anthropic request called `gemini_web_search`; after executing actual native search and submitting its result, the next main request called `aiimg_task_status`. Both main requests returned HTTP 200. No business tool was executed by this probe.

Protocol regression tests run independently of AstrBot:

```sh
python -m unittest discover -s integrations/astrbot-gemini-native-search -p test_native_search.py -v
```

Ten tests passed. They cover current conversation provider/key selection, native-only search payloads, route prefix preservation, query validation, grounding evidence, incomplete output, bounded transient retries, and sanitized errors.

## Operational limits

- At most two attempts per search: one initial attempt and one retry. HTTP 429/502/503/504, transport failures, invalid JSON, and incomplete output can trigger that retry. HTTP 400 and other nontransient statuses do not retry.
- Each request has a 120-second HTTP timeout and a 15-second connect timeout. This is not a strict overall wall-clock deadline; slow multi-chunk transfers may last longer. The plugin does not implement account failover or a circuit breaker.
- Query length is limited to 4,000 characters. Answers are limited to 20,000 characters and sources to 30 entries.
- Native search availability depends on the active Gemini model, credential group, and upstream route. HTTP 200 alone is insufficient: the plugin checks response status, usable output, and grounding metadata.
- Current personas allow the full registered tool set. If a persona later selects an explicit allowlist, add `gemini_web_search` to that allowlist.
- This validates plugin loading and the real model/search protocol. A user message through the QQ delivery channel has not been tested.
