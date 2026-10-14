# Gemini investigation, 2026-10-14

## Production evidence

The original DingTalk advertising task failed at 10:50 and 10:55 Asia/Taipei. The matching Sub2API requests were `46e11453-5b42-47f9-a637-4fe2c7fce6d4` and `75ddd9ec-1621-426b-835e-59e1051529cf`. Both ended with `empty Antigravity compatibility stream after keepalive`, on account 2 using `gemini-3.8-flash-high`. HTTP 200 had already been committed by a heartbeat, followed by the generic `empty_stream` error instead of a Responses terminal. The Agent SDK reported `stream closed before response.completed`.

This corrects the earlier claim that no empty-stream evidence existed. The operations database's 502 is synthesized by Sub2API; it is not proof of an original Google HTTP 502. No correlated 429 was found. These historical logs cannot determine whether Google produced no usable content or the parser discarded an unsupported shape. Account 2 also served hundreds of successful requests; the evidence does not justify disabling it.

The running binary was verified as Sub2API 0.2.16, commit `01842576b3d5c1e2545b5a99ad555d36e28ed306`, despite older image metadata. The original deployment image digest is recorded in the upstream integration documentation for rollback.

## Recovery and search

The local gateway now buffers heartbeats and empty Responses lifecycle metadata. It retries the identical request on recognized empty-stream failures before exposing model content, keeping previous tool results. Text, tool calls, nonempty output and unknown data commit the stream and prohibit replay. Cancellation and the shared attempt/time budget remain enforced. Four related test files passed 39 tests; the build passed. The gateway has been rebuilt and deployed.

The deployed AstrBot plugin is archived in `integrations/astrbot-gemini-native-search`. Its normal function calls Gemini native search through a separate Responses request. Real protocol verification returned grounding sources, then successfully selected the existing `aiimg_task_status` tool after the search result. The old tool was not executed. Ten plugin tests passed. QQ message delivery has not been tested.

After the upstream patch deployment, the same live provider path passed again: the main model selected `gemini_web_search`, the deployed plugin returned 15 grounding sources, and the next model turn selected the original `aiimg_task_status` tool. Both main-model requests returned HTTP 200; the full probe took 28.88 seconds. Only the public search was executed.

Google's current Gemini API documentation says built-in/custom tool combinations are in Preview for Gemini 3 and Gemini 4. That protocol support does not automatically carry over to the server's Antigravity/Responses compatibility route: the direct mixed-tools probe returned HTTP 200 here, while the observed historical 400 remains specific to its original route/request. The separately registered AstrBot search function keeps the existing business tools intact and was verified end to end through this provider path.

## Gemini 4 entitlement

Google's official model page returned HTTP 200 and identifies the stable model `gemini-4-argon`, updated 2026-10-13 UTC:

https://ai.google.dev/gemini-api/docs/models/gemini-4-argon

Both existing Antigravity accounts returned HTTP 200 for model discovery, with no Gemini 4 entry. Both directly returned HTTP 404, `Requested entity was not found`, when requesting `gemini-4-argon` through the configured Antigravity upstream. A Gemini 3.8 positive control returned HTTP 200, `OK`, and `finishReason: STOP` using the same authenticated path. Removing Sub2API's local allowlist cannot resolve this upstream denial. This does not establish entitlement to the separately billed Developer API.

Google's release notes identify the GA release date as 2026-10-13. Its current migration/pricing guide explicitly says Gemini 4 Argon is unavailable on the Free tier and Google AI Pro plan. The two server accounts report Google AI Pro, consistent with the observed lack of entitlement on this path. The separately billed Gemini API is a different access path; no billing account or API key was created.

Official references: `https://ai.google.dev/gemini-api/docs/changelog`, `https://ai.google.dev/gemini-api/docs/latest-model`, and `https://ai.google.dev/gemini-api/docs/tool-combination`. The current tool-combination guide covers Gemini 3 and Gemini 4 in Preview and describes context circulation fields that a compatibility adapter must preserve. The historical mixed-tool HTTP 400 should therefore be attributed to its specific route/request rather than asserted as a universal Gemini restriction.

## Real group E2E and remaining acceptance

After two DWS send attempts returned `RATE_LIMIT_ERROR`, the user manually sent the exact diagnostic request to the original group. This created real task `4d464fb6-8384-4983-936a-b9ce15110d7f` at 12:50:24 Asia/Taipei. It fetched authorized US advertising data and rendered a first PDF. The normal reviewer rejected that PDF for inconsistent report scopes, unsupported completeness and profitability claims, and unsupported object mappings. The model then fetched additional keyword data and recalculated its figures. The rejected PDF was never delivered.

The next model request, gateway `req-3j`, repeatedly hit the same upstream empty stream on account 3. Six attempts ended in `MODEL_REQUEST_RETRY_EXHAUSTED`; total request time was 394,207 ms. The task failed at 13:04:31 Asia/Taipei. No whole-task replay occurred. Audit counts: one artifact review, zero submitted artifacts, zero delivered artifacts. All 22 observed tool calls were reference, read, calculation, rendering or submission operations; no advertising mutation occurred. This proves that bounded request retries alone did not resolve the failure.

Immediately preceding successful requests included 313,699 request characters and 114,583 input tokens; Codex reported a 258,400-token context window. Another 60,080 ms request completed normally. These observations do not prove a fixed 60-second timeout or a context-window overflow. The exact failed wire body was not persisted, so reconstructed rollout contents must not be represented as an exact replay.

The upstream patch was deployed after this task ended. Health, frontend, a real Responses request and native grounded search passed. Long-task recovery, corrected PDF review, and actual delivery to the original group remain required before declaring advertising E2E successful. Evidence is archived under ignored `output/gemini-investigation/e2e-4d464fb6/`.
