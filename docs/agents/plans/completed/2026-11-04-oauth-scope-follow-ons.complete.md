# OAuth scope follow-ons and SEP-2243 header validation

**Status:** complete
**Date:** 2026-11-04

## Goal

Finish the follow-ons of `completed/2026-11-04-per-tool-oauth-scopes.complete.md` (#84): scopes on
prompts and resources, advertising scopes to clients, and validating the `Mcp-*` headers against
the body.

## Shipped

- **Prompt and resource scopes.** `createPrompt({ scopes })`, and `ResourceDefinitions.scopes` as
  a list or a synchronous function of the URI. They are enforced on `prompts/get` and
  `resources/read` the same way as tool scopes: HTTP `403 insufficient_scope`, the
  `ContextServer` check and client step-up. `ContextServer.requiredScopes` covers all three
  methods, and its check runs once, in dispatch.
- **Advertising.** `tools/list` and `prompts/list` list scopes under `_meta['dev.mokei/scopes']`
  (`SCOPES_META_KEY`), keeping an entry's own `_meta`.
- **SEP-2243 header validation** on `2026-07-28` POSTs, with the same checks as the MCP SDK v2
  server. Requests must carry `MCP-Protocol-Version`, `Mcp-Method` and, where the method mirrors a
  body field, `Mcp-Name` (Base64 sentinel decoded). Any header must agree with the body. Failures
  answer `400` with `-32020` and `data.mismatch: { header, body }`, before the scope check. This
  replaces the plain-text version-mismatch `400`. Notifications are only checked for
  disagreement. `MCP_NAME_HEADER_SOURCE` lives in `@mokei/context-protocol` for both sides.

## Decisions

- No filtering of `tools/list` by the caller's scopes: hidden tools could not be unlocked by
  step-up, and a session's cached list would depend on one token.
- Presence of the headers is required, not just agreement. This breaks hand-built clients that
  omit them; `@mokei/http-client` already sends them.
- **Declined:** a scope check keyed on headers in front of the handler. Once headers must match
  the body, it would see nothing new, and the body is parsed anyway.
- Resource subscriptions are not gated: their notifications carry only a URI.

## Deferred

`Mcp-Param-*` validation on the server, tracked in
`backlog/2026-09-04-oauth-hardening-followups.md`.
