# teikyo HTTP follow-ons

Small items left after moving `@mokei/http-server` onto `@sozai/http-server` and `@teikyo/oauth`
(see [the completed summary](../completed/2026-10-07-teikyo-http.complete.md)).

- `serveHTTP` captures the handler through a small `'mokei:serve'` plugin with a definite-assignment `let`; replace it
  with a server accessor once `@sozai/http-server` exposes plugin exports on `HTTPServer` (it does not in 0.1.1).
