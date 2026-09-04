# OAuth: coordinate token refresh across contexts sharing one token store

**Origin:** follow-up from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`).

## Problem

The OAuth client middleware's single-flight authorize/refresh map (`authFlights` in
`@mokei/http-client`'s `createOAuthMiddleware`) is deliberately per-middleware-instance: two
`createOAuthMiddleware` calls must never share a flight, because instance A's config
(clientId / PKCE / handler / store) deciding instance B's outcome — and B's own `store.set`
never running — would be wrong.

The consequence: when two contexts (e.g. two `/context add-http` connections in one `mokei chat`
process) point at the **same resource** and share the **same `--oauth-tokens` file**, each runs its
own refresh flight. With a rotating refresh token, both can redeem the same refresh token
concurrently; one redemption invalidates the other, causing a spurious re-authorization.

File **writes** are already serialized by the file store's per-resolved-path mutex, so there is no
file corruption — the residual is a redundant refresh / possible interactive re-auth in this narrow
same-resource + same-file case.

## Direction

Coordinate refreshes by store identity + resource + client configuration, or add an atomic
compare-and-set / lease operation to the `TokenStore` interface so a refresh can claim the slot
across instances. This is a behavioural contract change to a pluggable interface, so it needs its
own design pass (in-memory, file, and any consumer-supplied store must all implement the new
semantics or degrade safely).

Also consider a cross-process file lock for the file store: the per-path mutex is in-process only,
so two separate `mokei` processes sharing a tokens file can still race writes.

## Acceptance

Two contexts on the same resource sharing one token store perform at most one refresh flight for a
given rotating refresh token; no spurious re-authorization; existing single-instance behaviour and
the per-instance isolation guarantee are preserved.
