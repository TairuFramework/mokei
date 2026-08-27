/**
 * Stdio entry point serving a subscribe-capable mokei server (`subscriptions: true`, owning its
 * own hub) on `2026-07-28`.
 *
 * Deliberately not `serveProcess` (`@mokei/context-server-node`): that helper's `ServerConfig`-only
 * signature has no `subscriptions` field to opt into (it lives on `ServerParams` only), and this
 * entry also needs the constructed `ContextServer` itself in scope so the `emitUpdates` tool
 * (`createMokeiSubscriptionConfig`) can reach its `.events` -- not yet possible when the config is
 * built, hence the `let` and the deferred closure (the handler only runs once `server` is
 * assigned).
 *
 * `ContextServer#dispose()` (`_beforeTransportClose`, since this server OWNS its hub) is what
 * flushes the terminal `subscriptions/listen` result before the transport closes -- nothing calls
 * it automatically on a stdin `end`. The SDK v2 client's own `StdioClientTransport#close()` already
 * ends the child's stdin first (before escalating to SIGTERM/SIGKILL), so wiring `dispose()` to
 * that `end` event is what turns an ordinary `client.close()` into the graceful teardown the
 * interop suite observes via `McpSubscription#closed` resolving `'graceful'`.
 */
import { NodeStreamsTransport } from '@enkaku/node-streams'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'

import { createMokeiSubscriptionConfig } from './mokei-subscriptions-fixture.ts'
import { WATCHED_URI } from './subscriptions-fixture.ts'

let server: ContextServer

const config = createMokeiSubscriptionConfig({
  emit: () => {
    server.events.emit('resourceUpdated', { uri: WATCHED_URI })
    server.events.emit('resourcesListChanged', undefined)
  },
})

const transport = new NodeStreamsTransport<ClientMessage, ServerMessage>({
  streams: { readable: process.stdin, writable: process.stdout },
})

server = new ContextServer({ ...config, transport, subscriptions: true })

process.stdin.on('end', () => {
  void server.dispose()
})
