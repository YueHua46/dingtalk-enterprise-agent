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

The upstream patch was deployed after this task ended. Health, frontend, a real Responses request and native grounded search passed. Evidence is archived under ignored `output/gemini-investigation/e2e-4d464fb6/`.

## Captured termination and second deployment

The first controlled recovery reused the original task, thread, user, group, evidence and checkpoints. Its first request completed, but the next request exhausted six retries in 442,606 ms; the task failed at 13:34:42 Asia/Taipei. New sanitized diagnostics recorded exactly one wrapped data frame, one candidate, `finish_reasons={MAX_TOKENS:1}`, and no malformed JSON or provider error frame. Earlier interactive terminal wrapping made the count appear as 11; the actual JSON count is 1. These newly captured failures are output-budget terminations. Earlier uninstrumented failures cannot be assigned the same cause retrospectively.

The Responses bridge inserts `max_tokens=8192` when `max_output_tokens` is absent; the Gemini compatibility converter forwards it as `maxOutputTokens=8192`. The existing 64,000 default in a different request converter does not override this route. MAX_TOKENS with no visible content was buffered and discarded at EOF, then reported as retryable `empty_stream`. The failing original wire body and provider token breakdown were not saved, so the 8192 budget and hidden-thinking explanation are a code-path finding, not measured token telemetry for that request.

Sub2API `0.2.16-streamfix.2` now preserves an explicit MAX_TOKENS terminal as `response.incomplete` with reason `max_output_tokens`, including usage and an empty output array when appropriate. It never fabricates `response.completed`. It logs only numeric prompt, candidate and thought token counts. Full HTTP forwarding regressions cover direct/wrapped frames, with/without heartbeats, usage and absence of success or empty-stream terminals. The patch was deployed at 13:51:48 Asia/Taipei, with matching running binary hash, Docker healthy, `/health`, frontend and all six assets verified. Rollback retains the previous image and compose backup.

The Agent fills an absent Gemini Responses output budget using `GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS` (default 32768, 0 disables, maximum 64000). Production uses 64000, verified by a real same-provider request returning HTTP 200 and `response.completed`. Explicit caller limits, reasoning, tools and history are preserved. The reviewer applies the same default to its actual selected Gemini model. Explicit incomplete responses raise a semantic error rather than a transport TypeError, preventing identical-budget retries in both reviewer retry loops. Safe structural logs show the effective cap, known field types and counts, never prompt/tool contents or credentials.

The second controlled recovery started at 13:59:10 Asia/Taipei. Its first 552,899-character request logged `maxOutputTokens=64000` and completed normally in 76.740 seconds. The model generated a revised 15-page PDF and submitted it to the normal reviewer. The first revised submission was rejected for content issues; the model continued calculation and rendered another correction. At this recording point the task remains running, with no new stream failures and no confirmed delivered artifact. Content approval and actual original-group delivery remain the E2E acceptance criteria. The complete local suite passed 71 test files: 785 tests passed and one skipped.
