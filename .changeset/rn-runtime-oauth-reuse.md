---
"@mokei/context-client": patch
"@mokei/host": patch
"@mokei/host-node": patch
"@mokei/http-client": patch
"@mokei/session": patch
---

React Native support and safer HTTP auth: `HTTPTransport`, `addHTTPContext` and `createOAuthMiddleware` take a `@sozai/runtime` `runtime` for `fetch` and random values. An interactive OAuth sign-in no longer runs under the request timeout (new `authorizationTimeout`, default 10 minutes). Credentialed requests never follow redirects. The OAuth client flow runs on `@kokuin/oauth` 0.7.4. New `tracing.payloads: 'never'` keeps content and error message text out of telemetry, and the content-capture environment variable cannot override it.
