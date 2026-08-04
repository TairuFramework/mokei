## 0.11.0

### Minor Changes

- Support the MCP `2026-07-28` revision alongside `2025-11-25`, selected per context.

  `2026-07-28` is stateless: no `initialize` handshake, `server/discover` for capability
  discovery, and per-request log level. `protocolVersion: 'auto'` probes the server and speaks
  the newest revision both sides support — the default for host contexts and the CLI.

  Not implemented on `2026-07-28`: multi round-trip requests, so `sampling`, `elicitation` and
  `roots` are available on `2025-11-25` only; and `subscriptions/listen`.

  Also emits reasoning deltas from OpenAI-compatible servers, which were previously dropped.

  **Breaking changes:**

  - `ServerConfig.protocolVersions` is now required — list the revisions the server serves,
    e.g. `protocolVersions: ['2026-07-28', '2025-11-25']`.
  - `ClientParams.protocolVersion` is now required — a revision, or `'auto'`.
  - Servers handle requests concurrently instead of one at a time.
  - Result validation is stricter on both revisions and rejects malformed results that used to
    pass.
