# Server-side `Mcp-Param-*` validation

**Status:** complete
**Date:** 2026-11-04

## Goal

Close the last header gap left by `completed/2026-11-04-oauth-scope-follow-ons.complete.md`
(#85). The server should check SEP-2243 `Mcp-Param-*` headers against the `tools/call` body.

## Shipped

- **Check.** On `2026-07-28` `tools/call`, `validateParamHeaders` reads the tool's `inputSchema`
  (`ContextServer.toolInputSchema`), collects its `x-mcp-header` annotations (cached per schema
  object) and compares each `Mcp-Param-{Name}` header with the body argument. It follows the MCP
  SDK v2 server's rules:
  - an absent, `null` or non-primitive argument needs no header, and a stray header is ignored;
  - the Base64 sentinel is decoded, and numbers compare numerically;
  - a tool with invalid annotations is not checked.

  A failure answers `400` with `-32020`, and `data.mismatch.header` names the header. It runs in
  the stateless exchange's `authorize` hook, before the scope check.
- **Shared walker.** `collectHeaderAnnotations`, `isValidHeaderParamName` and their types move to
  `@mokei/context-protocol`. `@mokei/http-client` re-exports them, so its API is unchanged.
- **Client fix.** The stale-schema refresh read only a JSON `tools/list` answer, and a stateless
  mokei server always answers in SSE. So the refresh-and-retry never worked mokei-to-mokei. It now
  reads either body, matching the frame by its internal request id. An end-to-end test renames a
  header after `tools/list` and sees the call succeed after one retry.

## Decisions

- Tools with invalid annotations are skipped rather than rejected, since SEP-2243 clients exclude
  such tools. Only a `2026-07-28` path exists for this check: `2025-11-25` has no
  standard headers.
