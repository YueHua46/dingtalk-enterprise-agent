# Gemini investigation, 2026-10-14

## Production evidence

The original DingTalk advertising task failed at 10:50 and 10:55 Asia/Taipei. The matching Sub2API requests were `46e11453-5b42-47f9-a637-4fe2c7fce6d4` and `75ddd9ec-1621-426b-835e-59e1051529cf`. Both ended with `empty Antigravity compatibility stream after keepalive`, on account 2 using `gemini-3.8-flash-high`. HTTP 200 had already been committed by a heartbeat, followed by the generic `empty_stream` error instead of a Responses terminal. The Agent SDK reported `stream closed before response.completed`.

This corrects the earlier claim that no empty-stream evidence existed. The operations database's 502 is synthesized by Sub2API; it is not proof of an original Google HTTP 502. No correlated 429 was found. These historical logs cannot determine whether Google produced no usable content or the parser discarded an unsupported shape. Account 2 also served hundreds of successful requests; the evidence does not justify disabling it.

The running binary was verified as Sub2API 0.2.16, commit `01842576b3d5c1e2545b5a99ad555d36e28ed306`, despite older image metadata. The original deployment image digest is recorded in the upstream integration documentation for rollback.

## Recovery and search

The local gateway now buffers heartbeats and empty Responses lifecycle metadata. It retries the identical request on recognized empty-stream failures before exposing model content, keeping previous tool results. Text, tool calls, nonempty output and unknown data commit the stream and prohibit replay. Cancellation and the shared attempt/time budget remain enforced. Four related test files passed 39 tests; the build passed. The gateway has been rebuilt and deployed.

The deployed AstrBot plugin is archived in `integrations/astrbot-gemini-native-search`. Its normal function calls Gemini native search through a separate Responses request. Real protocol verification returned grounding sources, then successfully selected the existing `aiimg_task_status` tool after the search result. The old tool was not executed. Ten plugin tests passed. QQ message delivery has not been tested.

Responses native-search/function mixing returned HTTP 200 in this installation. Mixed tools must not be described as universally failing with 400; support depends on the route/model/version. Separating the search request keeps ordinary tools available and avoids relying on mixed-tool support.

## Gemini 4 entitlement

Google's official model page returned HTTP 200 and identifies the stable model `gemini-4-argon`, updated 2026-10-13 UTC:

https://ai.google.dev/gemini-api/docs/models/gemini-4-argon

Both existing Antigravity accounts returned HTTP 200 for model discovery, with no Gemini 4 entry. Both directly returned HTTP 404, `Requested entity was not found`, when requesting `gemini-4-argon` through the configured Antigravity upstream. A Gemini 3.8 positive control returned HTTP 200, `OK`, and `finishReason: STOP` using the same authenticated path. Removing Sub2API's local allowlist cannot resolve this upstream denial. This does not establish entitlement to the separately billed Developer API.

## Acceptance still pending

The original real group task failed and did not deliver a verified PDF. After the fixes, sending the new exact US 30-day diagnostic request through the current user's DWS profile failed twice with `RATE_LIMIT_ERROR`, using the same idempotency key. No new task was created. The native-window fallback also failed before performing any UI action. Do not substitute a mock task or bypass PDF evidence review to claim successful group E2E. A new group request must complete its evidence review and actual PDF delivery before this acceptance item can pass.
