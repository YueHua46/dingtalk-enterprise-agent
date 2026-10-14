# Sub2API Antigravity streaming fix

This patch applies to the official `Wei-Shaw/sub2api` **v0.2.16** source. It was deployed to the remote server on 2026-10-14 at approximately 13:06 Asia/Taipei, after the active advertising task ended. The local Agent gateway separately retries an empty request before any model content or tool output reaches its caller.

## Confirmed production failure

The real advertising E2E failed on 2026-10-14 at 10:50 and 10:55 (Asia/Taipei). Remote request IDs `46e11453-5b42-47f9-a637-4fe2c7fce6d4` and `75ddd9ec-1621-426b-835e-59e1051529cf` both used account 2 and ended with `empty Antigravity compatibility stream after keepalive`. Their input bodies were 321,367 and 452,376 bytes. Durations were 67.470 and 58.213 seconds. No usable model text, thinking, or function call was forwarded.

Sub2API sends a pre-content comment heartbeat after 15 seconds, committing HTTP 200. When the upstream scanner ends without meaningful content, the compatibility handler emits this 104-byte generic frame and closes:

```text
event: error
data: {"type":"error","error":{"type":"upstream_error","message":"empty_stream"}}

```

The Agent SDK then reports missing `response.completed`. The operations database records a synthesized 502/empty_stream error; that field does not establish an original upstream HTTP 502. Existing logs contain no provider code, finish reason, or sanitized frame structure for these two requests. Both accounts 2 and 3 also served hundreds of successful requests that day, so permanently disabling account 2 is not supported by this evidence.

## Candidate changes

- Select wrapped `response` versus direct Gemini `candidates`/usage shape explicitly. Previously a direct payload unmarshaled successfully into the wrapper with all unknown fields ignored, so fallback never ran and valid content was silently dropped. Regression tests reproduce this independent defect; there is no proof that the two historical failures used that shape.
- Record only counts, known finish reasons, numeric HTTP-style provider codes, and allowlisted error status enums when a compatibility stream has no content. No text, messages, arbitrary keys, model outputs, tool arguments, or raw frames are logged. Remove the existing malformed-function raw content logging.
- Emit a valid `response.created`/`response.failed` terminal for Responses errors. Empty failures carry `error.code=empty_stream` and `output=[]`; other failures retain `upstream_error`. Preserve partial output and usage in an incomplete snapshot without emitting `function_call_arguments.done` or `output_item.done` for an unfinished tool call. Repeated error calls cannot emit duplicate terminals. Chat Completions behavior stays intact.

This patch does not implement transparent upstream replay after the HTTP heartbeat. That requires coordinating request routing with already committed headers. The Agent gateway provides bounded request retries before exposing model content; it never repeats a request after content/tool arguments have begun.

## Apply and test

In a separate checkout of upstream tag v0.2.16:

```sh
git apply --check /path/to/sub2api-v0.2.16-stream.patch
git apply /path/to/sub2api-v0.2.16-stream.patch
cd backend
go test ./internal/pkg/antigravity -count=1
go test ./internal/service -run 'TestAntigravityCompat|TestAntigravityResponsesFailure' -count=1
```

Build a separate candidate image with the complete embedded frontend and existing deployment settings. Preserve the original image and compose configuration, verify no active requests before switching, and validate health, frontend, and protocol behavior with an immediate rollback on failure. Current remote `/home/ubuntu/sub2api-src` is an older extracted tree and must not be used as the v0.2.16 baseline.

## Source references

- https://github.com/Wei-Shaw/sub2api/blob/v0.2.16/backend/internal/service/antigravity_gateway_compat_stream.go
- https://github.com/Wei-Shaw/sub2api/blob/v0.2.16/backend/internal/pkg/antigravity/stream_transformer.go

## Validation

The full Antigravity package passed locally using Go 1.27.2. After the final error-code adjustment, the affected Antigravity tests passed in 1.642s and `TestAntigravityCompat|TestAntigravityResponsesFailure` passed in 11.958s. These cover failure protocol framing, empty arrays, matching response IDs/timestamps, partial text preservation, and incomplete tool safety. The upstream frontend was installed with its frozen lockfile using pnpm 9.15.9; its 3 locale tests, type checking, and production Vite build passed. The regenerated patch applies cleanly to the original v0.2.16 files.

Linux amd64 compilation passed with `CGO_ENABLED=0`, `-tags embed`, `-trimpath`, and version `0.2.16-streamfix.1` (original commit plus `+streamfix`, build type `local-patch`, actual build time `2026-10-14T04:50:40Z`). Binary artifact: `output/sub2api-stream-fix/sub2api-0.2.16-streamfix.1-linux-amd64`, 123,695,264 bytes; SHA-256 `519723228ee82c444c739631b1a47ca919c4587552fd7cac8534558974039e87`. The artifact is ignored; the patch and this record are the committed deliverables.

## Deployment and rollback

The deployment uses `sub2api-local:0.2.16-streamfix.1`, image ID `sha256:64f343e4f6bf28c3659862a39f33a3d5991db184e8ab3ab2364c1b1d75407ebe`. The running binary's `-version` confirms the patched version, original commit plus `+streamfix`, and the build timestamp above. `/health`, the embedded frontend and its assets passed live checks. A real Agent Responses request and native search with grounding also passed after the switch. These small probes do not establish that the long advertising task is fixed.

Remote compose directory: `/home/ubuntu/projects/sub2api-deploy`. Before changing only the service image, the switch script saved `docker-compose.yml.before-streamfix-20261014`; it automatically restores that file if health or frontend checks fail. For rollback during a safe maintenance window, restore that backup to `docker-compose.yml` and run `docker compose up -d --no-deps --pull never sub2api`. The original pinned image is retained. Do not roll back by rebuilding the older extracted source tree.
