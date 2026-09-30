# Task input lifecycle follow-ons

**Status:** open · follow-on of [task input lifecycle](../completed/2026-09-30-task-input-lifecycle.complete.md)
**Packages:** `@mokei/context-server`, `@mokei/context-client`

Minor findings parked during review. None affects correctness of the committed outcome.

## Items

- **Interleaving harness drain.** The scheduled-store harness `drain` yields with `setImmediate`
  only. A microtask-heavy path could leave work pending when invariants are checked.
- **Fake-timer cleanup.** Two context-client tests switch to fake timers without a
  `try/finally` restoring real timers, so a failure leaks fake timers into later tests.
- **Duplicate `onStatus`.** After a pushed notification followed by a `tasks/get` of the same
  revision, `TaskWaiter` can report the same snapshot to `onStatus` twice.
- **Withdrawn reason after submit.** A dispatch aborted after its answer was submitted can show
  the "withdrawn" reason to the handler although the answer was accepted.
- **Unguarded `requestInput` promise.** Called without a signal, the returned promise has no
  rejection handler attached internally; a caller that drops it gets an unhandled rejection when
  the task ends.
