# Deployment and verification

The `main.py`, `README.md`, `metadata.yaml`, and two verification JSON files were downloaded from the deployed plugin using SFTP. No API keys, passwords, provider configuration, or private chat content are included.

Initial 1.0.0 deployed `main.py` SHA-256:

`c9128f971ee68a179f7972cdee87dd2becc336be57fbbbe61f94c3b09f5b55a6`

The remote container file and this archived file had the same hash. AstrBot registered `gemini_web_search` at 2026-10-14 12:27:35 (+08) and reported `AstrBot started` at 12:27:38. The existing `aiimg_task_status` was also registered.

Real API checks used the existing AstrBot provider configuration and credential internally:

- Isolated native search returned `Web search queries` and Google Vertex grounding redirect sources.
- A Responses request combining native search and a normal function returned HTTP 200. The current route does not universally reject mixed tools.
- The main Anthropic request called `gemini_web_search`; after executing actual native search and submitting its result, the next main request called `aiimg_task_status`. Both main requests returned HTTP 200. No business tool was executed by this probe.

After the upstream switched to `sub2api-local:0.2.16-streamfix.1`, the same deployed plugin and provider passed another real tool-chain probe at 13:11 (+08): native search returned `ok` with 15 sources; the subsequent main request produced an `aiimg_task_status` tool call. Both main requests returned HTTP 200 and the complete probe took 28.88 seconds. The existing business tool was not executed. Sanitized evidence is in `post-streamfix-verification.json`.

Protocol regression tests run independently of AstrBot:

```sh
python -m unittest discover -s integrations/astrbot-gemini-native-search -p test_native_search.py -v
```

Twelve tests passed after the 1.1.0 update. They cover current conversation provider/key selection, native-only search payloads, route prefix preservation, query validation, grounding evidence, incomplete output, bounded transient retries, sanitized errors, current-public-fact detection, and automatic grounding preserving the persona and tool manager.

## Automatic current-fact grounding (1.1.0)

The original plugin only offered a tool, so the model could still answer a question about the latest release from stale memory. Version 1.1.0 registers `on_llm_request(priority=-1000000)` and automatically performs native search for explicit current public facts before main-model generation. The installed AstrBot source constructs the main agent/persona before dispatching the request hook; this priority also places the hook after the currently installed companion plugin handlers. Existing persona text and the tool-manager object are preserved.

The original question `我的世界基岩版最新版本现在是什么` was tested against the deployed hook, the saved `喵妹` persona, and the existing Anthropic Gemini provider with no forced `tool_choice`. Search returned grounded status `ok`; the main model returned HTTP 200 with release/preview distinction and citations. This exercises the deployed hook and real provider, but not all other plugin hooks or the QQ transport. Direct requests to Minecraft feedback article URLs returned HTTP 403, so the reported version/date was not independently verified from the publisher page. Do not treat this probe as independent certification of the latest Minecraft version.

Version 1.1.0 source SHA-256: `1a0d8e6485464be107ee0fa42da16350acb577fcac926dc1f94ae2ab6901bd36`.

## Operational limits

- At most two attempts per search: one initial attempt and one retry. HTTP 429/502/503/504, transport failures, invalid JSON, and incomplete output can trigger that retry. HTTP 400 and other nontransient statuses do not retry.
- Each request has a 120-second HTTP timeout and a 15-second connect timeout. This is not a strict overall wall-clock deadline; slow multi-chunk transfers may last longer. The plugin does not implement account failover or a circuit breaker.
- Query length is limited to 4,000 characters. Answers are limited to 20,000 characters and sources to 30 entries.
- Native search availability depends on the active Gemini model, credential group, and upstream route. HTTP 200 alone is insufficient: the plugin checks response status, usable output, and grounding metadata.
- Current personas allow the full registered tool set. If a persona later selects an explicit allowlist, add `gemini_web_search` to that allowlist.
- This validates plugin loading and the real model/search protocol. The real QQ latest-fact question was subsequently accepted by the user as recorded below.

## Live recheck at 2026-10-14 15:40 (+08)

Authenticated SSH inspection confirmed AstrBot and NapCat running and Sub2API healthy. The deployed plugin source SHA-256 still matches the archived 1.1.0 source above. A fresh execution of `verify_current_fact_live.py` against the actual deployed hook, current provider credential and saved persona returned HTTP 200, `end_turn`, grounding status `ok`, five sources, and 36.74 seconds elapsed. Persona prefix and the original tool object were preserved; tool choice was not forced. The refreshed sanitized result is in `current-fact-verification.json`. This is evidence of live grounding and model response behavior, not independent verification of the reported Minecraft version.

Read-only inspection of the recent AstrBot logs showed active received-message events and outgoing-message events through 15:42 (+08). No test message was sent. The recent logs also contained adapter, Qzone and response-stage errors, so these observations must not be described as a clean transport acceptance or proof that every outgoing message succeeded. The NapCat container's recent stdout log was empty. No correlated latest-fact QQ question and successful cited reply was established; the QQ latest-fact test was subsequently accepted by the user as recorded below.

## QQ latest-fact acceptance passed (2026-10-14)

The authorized user explicitly confirmed sending the test through the original QQ conversation and receiving a correct, current answer. This satisfies user acceptance of the stale-knowledge fix for the tested question. No additional tool test or message was requested or sent.

A single final read-only log scan independently identified the latest Bedrock question in the QQ adapter and event bus at 16:06:43 (+08), followed by the actual main-model request containing `current_public_web_evidence` at 16:07:02 (+08). This scan did not independently identify a concrete outgoing transport record; actual delivery and answer correctness are established by the user's explicit confirmation. Sanitized structural evidence is saved in `output/gemini-investigation/astrbot-qq-final-acceptance.json`. Model request dumps containing send-tool descriptions were excluded from outgoing-event evidence.

The previous live deployed-hook probe separately verifies that persona and the original tool manager were preserved; existing-tool selection after native search was verified in the earlier provider-chain probe. The current-public-fact detector remains intentionally bounded, so this acceptance should not be generalized to every possible freshness phrasing or independent certification of the Minecraft release number.
