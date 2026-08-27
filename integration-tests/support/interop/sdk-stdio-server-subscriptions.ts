/**
 * Stdio entry point serving the subscribe-capable subscriptions fixture with the official SDK v2
 * server on `2026-07-28`.
 *
 * `legacy: 'reject'` for the same reason as `sdk-stdio-server-2026-07-28.ts`: a mokei client that
 * silently fell back to `2025-11-25` would pass every assertion while testing the wrong revision,
 * and `2025-11-25` has no `subscriptions/listen` at all.
 *
 * `serveStdio` only writes the graceful terminal `subscriptions/listen` results (its
 * `StdioListenRouter.teardownAll()`) when the returned handle's `close()` runs — the stdio
 * transport does not tie closing to a stdin `end`. So the terminal-on-teardown case is driven by
 * the parent closing this child's stdin: the `end` handler below calls `handle.close()`, which
 * flushes the terminal frames to stdout before the wire closes, and the mokei client — still
 * reading — observes them.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKSubscriptionServer } from './subscriptions-fixture.ts'

const handle = serveStdio(() => createSDKSubscriptionServer(), { legacy: 'reject' })

process.stdin.on('end', () => {
  void handle.close()
})
