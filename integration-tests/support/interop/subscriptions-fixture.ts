/**
 * A subscribe-capable MCP surface served by the official SDK v2 `McpServer`, purpose-built for the
 * `subscriptions/listen` interop suite (SEP-1391 / SEP-2575).
 *
 * The server advertises `resources.subscribe` (so a mokei client auto-opens the listen and honors a
 * `resourceSubscriptions` filter) plus the three `listChanged` bits (so the acknowledged base
 * filter carries them and a `list_changed` is deliverable). It exposes one readable resource
 * ({@link WATCHED_URI}) and one `emitUpdates` tool.
 *
 * The tool exists for the STDIO transport only. `serveStdio` owns the per-connection listen router
 * and rewrites the pinned instance's outbound change notifications onto the open subscriptions
 * (`StdioListenRouter.routeOutbound`), so the way to make a spawned stdio server emit on demand is
 * to have the pinned instance itself emit — which a tool handler, running inside that instance,
 * can do via `server.server.sendResourceUpdated(...)` and `server.sendResourceListChanged()`. Over
 * HTTP the emission path is entirely different (`createMcpHandler`'s returned `notify` facade
 * publishes onto the handler's bus; a per-request tool instance cannot reach it), so the HTTP suite
 * drives `handler.notify.*` directly and never calls this tool. One fixture, two trigger seams —
 * each matching how the transport actually delivers subscription notifications.
 */
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv'

export const SUB_SERVER_NAME = 'interop-subscriptions-fixture'
export const SUB_SERVER_VERSION = '1.0.0'

/** The resource whose `resources/updated` notifications the suite subscribes to. */
export const WATCHED_URI = 'test://watched'
export const WATCHED_TEXT = 'Watched resource contents'

/** The tool the stdio suite calls to make the pinned instance emit its subscription notifications. */
export const EMIT_TOOL_NAME = 'emitUpdates'

const EMIT_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

/**
 * Builds the subscribe-capable SDK v2 server.
 *
 * `resources.subscribe` gates mokei's auto-open and its honoring of a `resourceSubscriptions`
 * filter; `resources.listChanged` / `tools.listChanged` / `prompts.listChanged` are what let the
 * acknowledged base filter carry the corresponding opt-ins (mokei's `#autoOpenFilter` only requests
 * a `listChanged` type the server advertises). The capabilities are advertised verbatim on both
 * transports — `createMcpHandler`'s listen router and `serveStdio`'s both narrow the honored filter
 * against exactly this set.
 */
export function createSDKSubscriptionServer(): McpServer {
  const validator = new AjvJsonSchemaValidator()
  const server = new McpServer(
    { name: SUB_SERVER_NAME, version: SUB_SERVER_VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      },
    },
  )

  server.registerResource('watched', WATCHED_URI, { mimeType: 'text/plain' }, (uri: URL) => ({
    contents: [{ uri: uri.href, mimeType: 'text/plain', text: WATCHED_TEXT }],
  }))

  server.registerTool(
    EMIT_TOOL_NAME,
    {
      description:
        'Emits notifications/resources/updated for the watched URI and notifications/resources/list_changed',
      inputSchema: fromJsonSchema<Record<string, never>>(EMIT_INPUT_SCHEMA, validator),
    },
    async () => {
      // Delivered on the pinned stdio instance's channel, where `serveStdio`'s outbound intercept
      // reroutes each onto every open `subscriptions/listen` that opted in. `sendResourceUpdated`
      // is a low-level `Server` method (the resource-updated notification carries the URI);
      // `sendResourceListChanged` is the high-level sugar for the resources list_changed.
      await server.server.sendResourceUpdated({ uri: WATCHED_URI })
      await server.sendResourceListChanged()
      return { content: [{ type: 'text', text: 'emitted' }] }
    },
  )

  return server
}
