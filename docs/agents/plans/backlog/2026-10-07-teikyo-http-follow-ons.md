# teikyo HTTP follow-ons

Small items left after moving `@mokei/http-server` onto `@sozai/http-server` and `@teikyo/oauth`
(see [the completed summary](../completed/2026-10-07-teikyo-http.complete.md)).

- Remove `'@teikyo/*'` from `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` once `@teikyo/oauth` 0.1.0 is older
  than the release-age window.
- Drop the unused `@hono/node-server` catalog entry from `pnpm-workspace.yaml`.
- Add `Retry-After` to the 503 the handler returns once shutdown has begun.
- `serveHTTP` captures the handler through a small `'mokei:serve'` plugin with a definite-assignment `let`; replace it
  with a server accessor if `@sozai/http-server` gains one.
- Tests: a `serveHTTP`-level GET/DELETE check; `dispose()` after `shutdown()` with a live session; an assertion that a
  custom `path` scopes the limits override to that path only; assert the `registered` promise in the late-listen race
  test.
