# Host desktop follow-ons

**Status:** open · follow-on of [host desktop interaction](../completed/2026-09-30-host-desktop.complete.md)
**Package:** `@mokei/host-desktop` (and `@mokei/host`)

## Items

- **Direct-context config type.** `AddDirectContextParams.config` in `@mokei/host` is typed
  `ServerConfig`, which lacks `subscriptions`, although `addDirectContext` spreads the config into
  the `ContextServer` at runtime. Widen it to `Omit<ServerParams, 'transport'>`; the host-desktop
  task integration test widens the type locally today.
- **Unverified backend behaviour.** zenity escaping follows the zenity 4 source only (3.x not
  checked). alerter JSON field names and argv parsing come from its docs; confirm on a Mac with
  alerter installed (README QA checklist). The first CI run is the first real zenity run.
- **Runner.** A runner timeout sends SIGTERM only, so a child ignoring it keeps the run pending
  until dispose. The next dialog may spawn before a killed one has exited.
- **Tools.** The runner that `createDesktopTools` creates on demand is never disposed (the README
  says to pass in and dispose a runner). An empty `notify` title is not replaced by `appName`.
  The own-timeout check could misclassify a coincident unrelated rejection.
- **Handler.** Disposal rejects queued and open requests with one shared error instance.
  `notifyAdded` does setup outside its `try`, so a synchronous throw would become an unhandled
  rejection. A notification may still be attempted after inbox disposal.
- **Tests.** A 300 ms TTL test and a 50 ms own-timeout test depend on real timers; the queue
  expiry test cannot isolate the queued budget; a few assertions are loose (`toMatch(/f/)` in form
  tests, `>= 3` occurrences in an osascript test); the e2e `backend.ask?.` gives a confusing diff if
  `ask` is missing.
- **Form validation.** `minLength`/`maxLength` count UTF-16 units, not code points.
