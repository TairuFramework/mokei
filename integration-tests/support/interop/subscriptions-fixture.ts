/**
 * SDK v2 fixture for `subscriptions/listen` interop (SEP-1391 / SEP-2575).
 * `resources.subscribe` enables mokei's listen and `resourceSubscriptions` filter;
 * three `listChanged` bits enable the corresponding notifications.
 *
 * The `emitUpdates` tool makes the pinned stdio server emit through
 * `StdioListenRouter.routeOutbound`. HTTP instead uses `createMcpHandler`'s
 * shared `notify` bus; a per-request tool instance cannot reach it.
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
 * Build the SDK v2 server. Both transports narrow the acknowledged filter to
 * advertised `resources.subscribe` and the three `listChanged` capabilities;
 * mokei's `#autoOpenFilter` requests only advertised types.
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
