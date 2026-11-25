---
"@mokei/context-protocol": patch
"@mokei/context-client": patch
"@mokei/context-server": patch
"@mokei/http-client": patch
"@mokei/host": patch
"@mokei/session": patch
"mokei": patch
---

Add the OAuth client credentials extension (`io.modelcontextprotocol/oauth-client-credentials`). `@mokei/http-client` exports `createClientCredentialsMiddleware`, which runs the client credentials grant with a signed `private_key_jwt` assertion, plus `createWebCryptoAssertionSigner` and the `ClientAssertionSigner` type. `createHTTPClient` and the host's `addHTTPContext` accept `clientCredentials` to build the middleware and declare the extension; combining it with `fetchMiddleware` throws. `ContextClient` and `ContextServer` take `oauthClientCredentials: true` to declare or advertise it, on both protocol revisions. Client assertions are built by `createClientAssertion` from `@kokuin/oauth`, which requires `@kokuin/oauth` 0.7.6 or later.
