# Per-tool OAuth scopes and step-up

**Status:** complete
**Date:** 2026-11-04
**PR:** #84

## Goal

Let a tool require OAuth scopes beyond the server-wide `requiredScopes`, answer a call made with a
token that lacks them with HTTP `403 insufficient_scope` on both protocol revisions, and have the
client step up instead of failing.

## Shipped

- **Tool scopes.** `createTool({ scopes })`, not listed in `tools/list`.
  `ContextServer.requiredScopes(request)` reports them for a `tools/call`. `ContextServer` rejects
  a call whose auth lacks them (`INVALID_REQUEST`, `data.error: 'insufficient_scope'`).
- **403 on both revisions.** `createHTTPHandler` checks after parsing the body and before dispatch.
  On `2025-11-25` it asks the session server before the request is queued. On `2026-07-28` it
  asks the per-POST server through `runStatelessExchange`'s `authorize` hook. The challenge names
  the server-wide and tool scopes, plus `resource_metadata`, and the body is a JSON-RPC error.
- **Client step-up.** On that `403` the OAuth middleware re-authorises for the configured, held and
  challenged scopes, stores the token under the same key with `StoredTokens.requestedScopes`, and
  retries once. Refreshes keep the wider scopes, and a 401 challenge's `scope` joins the sign-in.
  `stepUp: false` opts out. `parseBearerChallenge` is exported.

## Decisions

- `2025-11-25` needs no `Mcp-Method` header. The handler parses every POST body anyway, so the tool
  is read from the body on both revisions.
- The `Mcp-Method` and `Mcp-Name` headers are never used for authorisation. The server does not
  check them against the body, so they could be spoofed.
- Scopes are enforced only when a request carries auth. Stdio servers can reuse the same tool
  definitions.
- A stepped-up token replaces the token under the same store key. The middleware never prompts
  again for scopes it already requested, and concurrent `403`s share one sign-in.

## Deferred

Tracked in `backlog/2026-09-04-oauth-hardening-followups.md`:
- listing tool scopes in `tools/list`, or filtering the list by the caller's scopes;
- scopes on prompts and resources;
- a header-keyed check in front of the handler, which first needs header/body mismatch rejection.
