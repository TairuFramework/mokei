/**
 * Stdio entry point serving the subscribe-capable subscriptions fixture with the official SDK v2
 * server on `2026-07-28`.
 *
 * `legacy: 'reject'` for the same reason as `sdk-stdio-server-2026-07-28.ts`: a mokei client that
 * silently fell back to `2025-11-25` would pass every assertion while testing the wrong revision,
 * and `2025-11-25` has no `subscriptions/listen` at all.
 *
 * `serveStdio` only writes the graceful terminal `subscriptions/listen` results (its
 * `StdioListenRouter.teardownAll()`) when the returned handle's `close()` runs. Since SDK 2.1.0 the
 * `StdioServerTransport` also closes itself on stdin end-of-file, and that path tears the
 * connection down WITHOUT writing the terminal results — and its `end` listener runs before any
 * listener added here, turning a later `handle.close()` into a no-op. So the transport reads from a
 * proxy of stdin that never sees end-of-file, and the real stdin `end` calls `handle.close()`,
 * which flushes the terminal frames to stdout before closing the wire; the mokei client — still
 * reading — observes them.
 */
import { PassThrough } from 'node:stream'
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKSubscriptionServer } from './subscriptions-fixture.ts'

const input = new PassThrough()
process.stdin.pipe(input, { end: false })

const handle = serveStdio(() => createSDKSubscriptionServer(), {
  legacy: 'reject',
  transport: new StdioServerTransport(input, process.stdout),
})

process.stdin.on('end', () => {
  void handle.close()
})
