## 0.12.0

### Minor Changes

- Support multi round-trip requests (MRTR, SEP-2322) on the `2026-07-28` revision, and recover
  from stale tool schemas on `x-mcp-header` requests.

  **Correction to 0.11.0:** that release's notes stated that multi round-trip requests were not
  implemented on `2026-07-28`, and that `sampling`, `elicitation` and `roots` were therefore
  available on `2025-11-25` only. That is no longer true — all three work on both revisions as of
  this release.

  ## MRTR on `2026-07-28`

  `2026-07-28` removes server-initiated top-level requests, so `sampling/createMessage`,
  `elicitation/create` and `roots/list` previously had no wire mechanism there and were refused at
  setup with `MRTRNotSupportedError`. SEP-2322 replaces them with a request-level retry loop:
  `tools/call`, `prompts/get` and `resources/read` answer terminally with
  `resultType: 'input_required'`, carrying embedded `inputRequests`, and the client retries the
  same request with the matching `inputResponses` until it gets a final result.

  Both sides are implemented and verified against `@modelcontextprotocol/*` 2.0.0 in the interop
  suite. The client drives the loop transparently, so existing `sampling`, `elicitation` and
  `roots` handlers keep working unchanged when a context negotiates `2026-07-28`.

  New exports:

  - `@mokei/context-protocol`: `inputRequest`, `inputRequests`, `inputResponse`, `inputResponses`,
    `isInputRequiredResult`, `INPUT_REQUEST_CAPABILITIES`, and the `InputRequest`,
    `InputResponse` and `InputRequiredResult` types.
  - `@mokei/context-client`: `isInputRequiredResult`, `InputRequiredRoundsExceededError`,
    `InputRequiredTotalTimeoutError`, `DEFAULT_MAX_ROUNDS`, `REQUEST_STATE_ONLY_PACING_MS`, and
    the `InputRequiredResult` and `InputRequiredRetryParams` types.
  - `@mokei/context-server`: `inputRequired`, `MRTR_METHODS`, `isInputRequiredResult`, and the
    `InputRequiredResult` and `RequestStateHooks` types.

  The retry loop is bounded — `DEFAULT_MAX_ROUNDS` rounds and an overall timeout, surfaced as
  `InputRequiredRoundsExceededError` and `InputRequiredTotalTimeoutError`.

  ## Stale `x-mcp-header` schema retry

  The HTTP client caches each tool's `inputSchema` from `tools/list` and reads its `x-mcp-header`
  annotations (SEP-2243) on every `tools/call`. When a peer's schema changed under a connected
  client, the client kept sending the pre-change header set and the call failed with
  `param-header-missing`. It now refetches `tools/list` and retries the call once with the fresh
  annotations.
