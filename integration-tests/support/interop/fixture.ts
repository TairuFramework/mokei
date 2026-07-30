/**
 * A single MCP surface, defined twice: once with mokei's server API and once with the
 * official SDK v2 API. Both sides expose identical tools and prompts, so every interop test can
 * assert the same tool/prompt expectations regardless of which implementation serves.
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
 * If a future change needs the SDK side to expose a template or `complete` too (e.g. a shared
 * "both sides have identical resources" assertion), extend `createSDKServer()` explicitly rather
 * than assuming this asymmetry is accidental — it isn't.
 */
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { createPrompt, createTool, type ServerConfig } from '@mokei/context-server'

export const SERVER_NAME = 'interop-fixture'
export const SERVER_VERSION = '1.0.0'

export const GREETING_URI = 'test://greeting'
export const GREETING_TEXT = 'Hello from the interop fixture'

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
 * `protocolVersions` defaults to `['2025-11-25']` so existing callers (the `2025-11-25`
 * interop suites) are unaffected; the `2026-07-28` stdio fixture passes `['2026-07-28']`.
 */
export function createMokeiConfig(
  protocolVersions: Array<ProtocolVersion> = ['2025-11-25'],
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
export function createSDKServer(): McpServer {
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

  return server
}
