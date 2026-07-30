/**
 * A single MCP surface, defined twice: once with mokei's server API and once with the
 * official SDK v2 API. Both sides expose identical tools, prompts and resources, so every
 * interop test can assert the same expectations regardless of which implementation serves.
 */
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv'
import { createPrompt, createTool, type ServerConfig } from '@mokei/context-server'

export const SERVER_NAME = 'interop-fixture'
export const SERVER_VERSION = '1.0.0'

export const GREETING_URI = 'test://greeting'
export const GREETING_TEXT = 'Hello from the interop fixture'

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

/** The fixture served by `@mokei/context-server`. */
export function createMokeiConfig(): ServerConfig {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocolVersions: ['2025-11-25'],
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
      read: ({ params }) => ({
        contents: [{ uri: params.uri, mimeType: 'text/plain', text: GREETING_TEXT }],
      }),
    },
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
