# React Native fetch and crypto injection

**Status:** next (2 of 3, after per-call elicitation routing)
**Requested by:** Yosura (mobile phase)

React Native hosts cannot run the HTTP transport and OAuth client unchanged:

- PKCE uses `crypto.subtle.digest`, which the Expo crypto polyfill lacks.
- The HTTP transport calls `globalThis.fetch`. Yosura injects `expo/fetch` for streaming
  responses and needs mokei to use it.

Add injection options for `fetch` and the digest (or a crypto provider) on the HTTP transport,
the OAuth middleware and `addHTTPContext`, defaulting to the globals. Independent of reconnect.
