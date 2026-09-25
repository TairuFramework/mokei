---
'@mokei/http-client': minor
'@mokei/http-server': minor
---

The JWKS verifier now reports a failed or oversized AS-metadata or JWKS fetch, and a non-https OAuth endpoint, as a plain `Error`, so `serveHTTP` answers HTTP 500 rather than a 401 that sends clients back into authorisation. Its loopback check also accepts `[::1]` and `*.localhost` hosts.

When a refresh is rejected with `invalid_grant`, the OAuth client middleware clears the stored tokens (unless another flight already replaced them) and re-authorises instead of retrying the dead refresh token. Non-2xx OAuth responses are drained before throwing.
