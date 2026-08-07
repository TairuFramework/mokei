/**
 * A single MCP surface, defined twice: once with mokei's server API and once with the
 * official SDK v2 API. Both sides expose identical prompts, so every interop test can assert the
 * same prompt expectations regardless of which implementation serves. Tools and resources are
 * both asymmetric — see the `MOKEI_TOOL_NAMES`/`SDK_TOOL_NAMES` comment below for the tool split
 * (`headerEcho` is SDK-only) and the rest of this header for the resource split.
 *
 * Resources are asymmetric, deliberately: `createMokeiConfig()` also serves a resource template
 * (`ITEM_TEMPLATE_URI`) and a `complete` handler, but `createSDKServer()` has neither. Both were
 * added to exercise schemas that only the `2026-07-28` conformance suite
 * (`interop-2026-07-28-stdio.test.ts`) checks — `ListResourceTemplatesResultSchema` and
 * `CompleteResultSchema` — and no `2025-11-25` suite (SDK-client-against-mokei,
 * mokei-client-against-SDK, or either HTTP combo) calls `listResourceTemplates` or `complete`,
 * so the extra surface is inert there. `createSDKServer()` was intentionally left without a
 * matching template/`complete` handler: no suite exercises it on that side either, and adding it
 * would be unused surface for its own sake.
 *
 * They live in the *shared* `createMokeiConfig()` rather than a `2026-07-28`-only fixture
 * because `createMokeiConfig` is already parameterized by `protocolVersions` and reused
 * verbatim by every `2025-11-25` mokei-server suite; a second config function would duplicate
 * every tool/prompt/resource definition in this file for the sake of two extra fields. The one
 * side effect worth knowing about: enabling `complete` flips on the `completions` server
 * capability for *both* revisions (`packages/context-server/src/server.ts:162-165` — the
 * capability is set whenever `params.complete != null`, unconditional on protocol version).
 * That's harmless today because no `2025-11-25` suite asserts the capability set, but the next
 * person adding one should know why `completions` shows up.
 *
 * If a future change needs the SDK side to expose a template, `complete` handler, or a matching
 * tool set too (e.g. a shared "both sides have identical surface" assertion), extend
 * `createSDKServer()` explicitly rather than assuming this asymmetry is accidental — it isn't.
 */
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { createPrompt, createTool, type ServerConfig } from '@mokei/context-server'

export const SERVER_NAME = 'interop-fixture'
export const SERVER_VERSION = '1.0.0'

export const GREETING_URI = 'test://greeting'
export const GREETING_TEXT = 'Hello from the interop fixture'

/**
 * A resource URI carrying characters no HTTP header value can hold raw: the `Mcp-Name` header
 * mirrors `params.uri` for `resources/read`, and a header value is a ByteString. Served by
 * `createSDKServer()` only — the point of it is to put the Base64 sentinel in front of a
 * conformant *decoder*, which is the SDK's, and mokei's own server never reads the header back.
 */
export const NON_ASCII_RESOURCE_URI = 'test://notes/文書.md'

/**
 * The form the SDK is *registered* with, and therefore the one it echoes back in `contents`.
 *
 * SDK `2.0.0` lists a resource under the string it was registered with but looks a read up by
 * `new URL(params.uri).href`, so registering the raw URI above makes every read of it miss with
 * "Resource not found". Registering the percent-encoded form makes the two agree. What the
 * client sends — and therefore what the header carries and the server cross-checks — is still
 * the raw URI.
 */
export const NON_ASCII_RESOURCE_REGISTERED_URI = 'test://notes/%E6%96%87%E6%9B%B8.md'

export const NON_ASCII_RESOURCE_TEXT = 'Notes filed under a non-ASCII URI'

/**
 * The exact resource set each fixture serves. They differ — only the SDK side carries the
 * non-ASCII resource, since the point of it is a conformant `Mcp-Name` decoder and mokei's own
 * server never reads that header back — so an assertion shared across both stacks has to be told
 * which one it is looking at rather than weakened to a subset check.
 */
export const MOKEI_RESOURCE_URIS: ReadonlyArray<string> = [GREETING_URI]
export const SDK_RESOURCE_URIS: ReadonlyArray<string> = [
  GREETING_URI,
  NON_ASCII_RESOURCE_REGISTERED_URI,
]

/**
 * The exact tool set each fixture serves. They differ for the same reason the resource sets do:
 * only the SDK side carries `headerEcho`, whose `x-mcp-header` annotations exist to put mokei's
 * `Mcp-Param-*` encoder in front of a conformant decoder. mokei's own server never reads those
 * headers back, so the tool would be inert surface on that side.
 */
export const MOKEI_TOOL_NAMES: ReadonlyArray<string> = ['echo', 'sum']
export const SDK_TOOL_NAMES: ReadonlyArray<string> = ['echo', 'headerEcho', 'sum']

export const ITEM_TEMPLATE_URI = 'test://items/{id}'
export const ITEM_TEMPLATE_NAME = 'item'

const ITEM_URI_PREFIX = 'test://items/'

export function itemURI(id: string): string {
  return `${ITEM_URI_PREFIX}${id}`
}

export function itemText(id: string): string {
  return `Item ${id}`
}

export const COMPLETION_VALUES = ['Ada', 'Alan', 'Grace']

export const ECHO_INPUT_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
} as const

export const SUM_INPUT_SCHEMA = {
  type: 'object',
  properties: { a: { type: 'number' }, b: { type: 'number' } },
  required: ['a', 'b'],
  additionalProperties: false,
} as const

export const SUM_OUTPUT_SCHEMA = {
  type: 'object',
  properties: { total: { type: 'number' } },
  required: ['total'],
  additionalProperties: false,
} as const

/**
 * Two `x-mcp-header`-annotated arguments (SEP-2243), both optional so the omitted-argument case
 * is reachable. `integer` rather than `number` deliberately: neither mokei's encoder nor the SDK's
 * decoder admits an arbitrary number, and the integer path is compared numerically on the SDK
 * side while mokei writes canonical decimal.
 */
export const HEADER_ECHO_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    tenant: { type: 'string', 'x-mcp-header': 'Tenant' },
    limit: { type: 'integer', 'x-mcp-header': 'Limit' },
  },
  additionalProperties: false,
} as const

/**
 * `HEADER_ECHO_INPUT_SCHEMA` with the annotations stripped and nothing else changed.
 *
 * A client that cached this form sends the same body with no `Mcp-Param-*` header — what a peer
 * whose schema gained an annotation since the last `tools/list` answers `param-header-missing`.
 */
export const HEADER_ECHO_UNANNOTATED_SCHEMA = {
  type: 'object',
  properties: {
    tenant: { type: 'string' },
    limit: { type: 'integer' },
  },
  additionalProperties: false,
} as const

/** Either form of the `headerEcho` `inputSchema`, for a server that switches between them. */
export type HeaderEchoSchema =
  | typeof HEADER_ECHO_INPUT_SCHEMA
  | typeof HEADER_ECHO_UNANNOTATED_SCHEMA

/** Options for {@link createSDKServer}, threaded through by `startSDK20260728HTTPServer`. */
export type SDKServerOptions = {
  /**
   * Which `headerEcho` `inputSchema` to register. A getter because `createMcpHandler` runs its
   * factory per request, so a test can change the peer's schema between two calls. Defaults to
   * the annotated form.
   */
  headerEchoSchema?: () => HeaderEchoSchema
}

/**
 * What `headerEcho` returns. Reaching this text at all is the assertion: the SDK validates every
 * `Mcp-Param-*` header against the body `arguments` *before* dispatch, so a disagreeing or absent
 * header is answered `-32020` and the handler never runs.
 */
export function headerEchoText(tenant: string | undefined, limit: number | undefined): string {
  return JSON.stringify({ tenant: tenant ?? null, limit: limit ?? null })
}

export const GREET_ARGUMENTS_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
} as const

export function greetingMessage(name: string): string {
  return `Greetings, ${name}!`
}

/**
 * The fixture served by `@mokei/context-server`.
 *
 * `protocolVersions` defaults to both revisions, matching what mokei's own bundled servers
 * declare. Suites that need a single-revision server — the version-detection cases — pass
 * an explicit one-element list.
 */
export function createMokeiConfig(
  protocolVersions: Array<ProtocolVersion> = ['2026-07-28', '2025-11-25'],
): ServerConfig {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocolVersions,
    tools: {
      echo: createTool({
        description: 'Echo the provided text',
        inputSchema: ECHO_INPUT_SCHEMA,
        handler: ({ input }) => ({ content: [{ type: 'text', text: input.text }] }),
      }),
      sum: createTool({
        description: 'Add two numbers',
        inputSchema: SUM_INPUT_SCHEMA,
        outputSchema: SUM_OUTPUT_SCHEMA,
        handler: ({ input }) => ({ structuredContent: { total: input.a + input.b } }),
      }),
    },
    prompts: {
      greet: createPrompt({
        description: 'Greet someone by name',
        argumentsSchema: GREET_ARGUMENTS_SCHEMA,
        handler: ({ input }) => ({
          messages: [
            { role: 'user', content: { type: 'text', text: greetingMessage(input.name) } },
          ],
        }),
      }),
    },
    resources: {
      list: [{ uri: GREETING_URI, name: 'greeting', mimeType: 'text/plain' }],
      listTemplates: [
        { uriTemplate: ITEM_TEMPLATE_URI, name: ITEM_TEMPLATE_NAME, mimeType: 'text/plain' },
      ],
      read: ({ params }) => {
        if (params.uri === GREETING_URI) {
          return { contents: [{ uri: params.uri, mimeType: 'text/plain', text: GREETING_TEXT }] }
        }
        if (!params.uri.startsWith(ITEM_URI_PREFIX)) {
          throw new Error(`Unknown resource URI: ${params.uri}`)
        }
        const id = params.uri.slice(ITEM_URI_PREFIX.length)
        return { contents: [{ uri: params.uri, mimeType: 'text/plain', text: itemText(id) }] }
      },
    },
    complete: ({ params }) => ({
      completion: {
        values: COMPLETION_VALUES.filter((value) =>
          value.toLowerCase().startsWith(params.argument.value.toLowerCase()),
        ),
        hasMore: false,
      },
    }),
  }
}

/** The same fixture served by the official SDK v2 `McpServer`. */
export function createSDKServer(options: SDKServerOptions = {}): McpServer {
  const validator = new AjvJsonSchemaValidator()
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  )

  server.registerTool(
    'echo',
    {
      description: 'Echo the provided text',
      inputSchema: fromJsonSchema<{ text: string }>(ECHO_INPUT_SCHEMA, validator),
    },
    ({ text }) => ({ content: [{ type: 'text', text }] }),
  )

  server.registerTool(
    'sum',
    {
      description: 'Add two numbers',
      inputSchema: fromJsonSchema<{ a: number; b: number }>(SUM_INPUT_SCHEMA, validator),
      outputSchema: fromJsonSchema<{ total: number }>(SUM_OUTPUT_SCHEMA, validator),
    },
    ({ a, b }) => ({
      content: [{ type: 'text', text: JSON.stringify({ total: a + b }) }],
      structuredContent: { total: a + b },
    }),
  )

  server.registerTool(
    'headerEcho',
    {
      description: 'Echo arguments that are mirrored into Mcp-Param-* request headers',
      inputSchema: fromJsonSchema<{ tenant?: string; limit?: number }>(
        options.headerEchoSchema?.() ?? HEADER_ECHO_INPUT_SCHEMA,
        validator,
      ),
    },
    ({ tenant, limit }) => ({ content: [{ type: 'text', text: headerEchoText(tenant, limit) }] }),
  )

  server.registerPrompt(
    'greet',
    {
      description: 'Greet someone by name',
      argsSchema: fromJsonSchema<{ name: string }>(GREET_ARGUMENTS_SCHEMA, validator),
    },
    ({ name }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: greetingMessage(name) } }],
    }),
  )

  server.registerResource('greeting', GREETING_URI, { mimeType: 'text/plain' }, (uri: URL) => ({
    contents: [{ uri: uri.href, mimeType: 'text/plain', text: GREETING_TEXT }],
  }))

  server.registerResource(
    'notes',
    NON_ASCII_RESOURCE_REGISTERED_URI,
    { mimeType: 'text/plain' },
    (uri: URL) => ({
      contents: [{ uri: uri.href, mimeType: 'text/plain', text: NON_ASCII_RESOURCE_TEXT }],
    }),
  )

  return server
}
