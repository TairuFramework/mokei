/**
 * A subscribe-capable MCP surface served by `@mokei/context-server` -- the mokei-owned counterpart
 * to `subscriptions-fixture.ts`'s SDK v2 server, reusing its `WATCHED_URI`/`WATCHED_TEXT`/
 * `EMIT_TOOL_NAME` constants so both directions of the `subscriptions/listen` interop suite
 * (SEP-1391 / SEP-2575) watch and emit the same thing.
 *
 * mokei's `ContextServer` advertises `resources.subscribe` automatically whenever both a resource
 * set AND a subscription hub (owned via `subscriptions: true`, or borrowed via `subscriptionHub`)
 * are configured (`packages/context-server/src/server.ts`) -- so the resource set below is enough
 * to get the capability on either transport, without repeating it explicitly per entry point.
 *
 * The `emit` seam mirrors the SDK fixture's reasoning, from the mokei side: a spawned STDIO server
 * is a separate process, so a test cannot reach its `ContextServer#events` directly -- the
 * `emitUpdates` tool, running *inside* that process, is what lets the (SDK v2) client under test
 * trigger it on demand (see `mokei-stdio-server-subscriptions.ts`). Over HTTP there is no spawned
 * process: the durable hub's events are driven straight from the test
 * (`startMokeiSubscriptionsHTTPServer`'s `notify`), so `emit` is left unset there and no tool is
 * registered -- unused surface for its own sake.
 */
import { createTool, type ServerConfig } from '@mokei/context-server'

import { EMIT_TOOL_NAME, WATCHED_TEXT, WATCHED_URI } from './subscriptions-fixture.ts'

export const MOKEI_SUB_SERVER_NAME = 'interop-subscriptions-mokei-fixture'
export const MOKEI_SUB_SERVER_VERSION = '1.0.0'

const EMIT_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

export type MokeiSubscriptionConfigOptions = {
  /**
   * Registers `emitUpdates`, whose handler calls this instead of reaching for
   * `ContextServer#events` directly -- the server this config builds does not exist yet at the
   * point the config itself is built, so the entry point supplies a closure over it instead (see
   * `mokei-stdio-server-subscriptions.ts`).
   */
  emit?: () => void
}

/**
 * Builds the subscribe-capable mokei server config. `protocolVersions` is `2026-07-28` only: the
 * revision `subscriptions/listen` exists on.
 */
export function createMokeiSubscriptionConfig(
  options: MokeiSubscriptionConfigOptions = {},
): ServerConfig {
  const { emit } = options
  return {
    name: MOKEI_SUB_SERVER_NAME,
    version: MOKEI_SUB_SERVER_VERSION,
    protocolVersions: ['2026-07-28'],
    resources: {
      list: [{ uri: WATCHED_URI, name: 'watched', mimeType: 'text/plain' }],
      read: ({ params }) => {
        if (params.uri !== WATCHED_URI) {
          throw new Error(`Unknown resource URI: ${params.uri}`)
        }
        return { contents: [{ uri: params.uri, mimeType: 'text/plain', text: WATCHED_TEXT }] }
      },
    },
    ...(emit != null && {
      tools: {
        [EMIT_TOOL_NAME]: createTool({
          description:
            'Emits notifications/resources/updated for the watched URI and notifications/resources/list_changed',
          inputSchema: EMIT_INPUT_SCHEMA,
          handler: () => {
            emit()
            return { content: [{ type: 'text' as const, text: 'emitted' }] }
          },
        }),
      },
    }),
  }
}
