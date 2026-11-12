# Context reconnect follow-ups

Low-priority items left after opt-in context reconnect
(`docs/agents/plans/completed/2026-11-12-context-reconnect.complete.md`).

## Behaviour

- `HTTPTransport.write()` serialises sends, so a cancel can queue behind a hanging POST
  (pre-existing).
- A post-dispatch abort rejects with the client's `Error('Cancelled')` instead of the signal's
  reason (pre-existing client behaviour).

## Test gaps

- Sessionless GET `404` (only `405` is tested).
- OAuth join test relies on a 20 ms sleep.
- Host "no DELETE on session expiry" test passes without `terminateSession: false` (covered in the
  http-client unit test).
- Spawn-env test asserts only three variables; add full-env, explicit `undefined` and shadowing
  cases.
- CLI `ChatApp` test emitter ignores abort; add unmount and session-replacement listener tests.
- host-node suite is load-sensitive (SIGKILL escalation test uses a fixed 200 ms wait).
