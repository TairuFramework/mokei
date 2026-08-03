import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import {
  ENVELOPE_VIOLATION,
  INVALID_PARAMS,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
} from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import { ContextServer, createPrompt, createTool } from '../src/index.js'

// The HTTP transport keys its `400` mapping off `error.data[ENVELOPE_VIOLATION]`
// (`packages/http-server/src/stateless.ts`, `isEnvelopeFailure`), not off message text. Pinned
// here so a thrower that stops attaching the marker — or one added later that should but
// doesn't — is caught in this package rather than surfacing as a silently wrong HTTP status in
// a different one.

/** A well-formed `2026-07-28` request envelope, so only the call itself can fail. */
const REQUEST_META = {
  [META_PROTOCOL_VERSION]: '2026-07-28',
  [META_CLIENT_CAPABILITIES]: {},
}

type ResponseBody = {
  error?: { code: number; message: string; data?: unknown }
  result?: { isError?: boolean; content?: Array<{ text?: string }> }
}

/** Sends one request to a `2026-07-28`-only server and returns the response it answers. */
async function respondTo(request: Omit<ClientRequest, 'jsonrpc' | 'id'>): Promise<ResponseBody> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  new ContextServer({
    name: 'envelope-test',
    version: '0.0.0',
    protocolVersions: ['2026-07-28'],
    // Built with `createTool`/`createPrompt` rather than declared inline: argument
    // validation comes from the validator those compile, so a plain definition never
    // raises the validation errors the cases below are about.
    tools: {
      echo: createTool({
        description: 'Echo input',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        handler: () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      }),
    },
    prompts: {
      greet: createPrompt({
        description: 'Greet someone',
        argumentsSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
        handler: () => ({ messages: [] }),
      }),
    },
    transport: transports.server,
  })
  transports.client.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ClientRequest)
  const read = await transports.client.read()
  await transports.dispose()
  return read.value as unknown as ResponseBody
}

/** The JSON-RPC error a request answers with. Fails the test if it answered a result. */
async function errorFor(
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
): Promise<{ code: number; message: string; data?: unknown }> {
  const body = await respondTo(request)
  expect(body.error).toBeDefined()
  return body.error as { code: number; message: string; data?: unknown }
}

/** Whether an error's `data` carries the marker the transport classifies a `400` by. */
function isMarkedEnvelopeViolation(error: { data?: unknown }): boolean {
  return (error.data as Record<string, unknown> | undefined)?.[ENVELOPE_VIOLATION] === true
}

describe('envelope failure messages', () => {
  test('name the _meta key they are about', () => {
    expect(META_PROTOCOL_VERSION).toBe('io.modelcontextprotocol/protocolVersion')
    expect(META_CLIENT_CAPABILITIES).toBe('io.modelcontextprotocol/clientCapabilities')
    expect(INVALID_PARAMS).toBe(-32602)
  })

  // The `data` marker is what the transport keys its `400` classification on; the message is
  // pinned alongside it only because it names the `_meta` key a caller is missing, which is
  // useful independently of that classification.
  test('a missing protocol version names its _meta key and marks the envelope violation', async () => {
    const error = await errorFor({ method: 'tools/list', params: {} })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(error.message).toBe(`Missing "${META_PROTOCOL_VERSION}" in request _meta`)
    expect(error.data).toEqual({ [ENVELOPE_VIOLATION]: true })
  })

  test('missing client capabilities names its _meta key and marks the envelope violation', async () => {
    const error = await errorFor({
      method: 'tools/list',
      params: { _meta: { [META_PROTOCOL_VERSION]: '2026-07-28' } },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(error.message).toBe(`Missing "${META_CLIENT_CAPABILITIES}" in request _meta`)
    expect(error.data).toEqual({ [ENVELOPE_VIOLATION]: true })
  })
})

// The other half of the coupling. Every application-level `INVALID_PARAMS` that can reach a
// client shares its code with the two envelope failures above, so none of them may carry the
// `ENVELOPE_VIOLATION` marker in their `data` — including when the caller controls part of the
// message, which it does for a tool or prompt name.
describe('application errors sharing INVALID_PARAMS', () => {
  test('an unknown tool stays clear of the envelope marker', async () => {
    const error = await errorFor({
      method: 'tools/call',
      params: { name: 'nope', arguments: {}, _meta: REQUEST_META },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(isMarkedEnvelopeViolation(error)).toBe(false)
  })

  test('a tool name mimicking a _meta key stays clear of the envelope marker', async () => {
    const error = await errorFor({
      method: 'tools/call',
      params: { name: 'io.modelcontextprotocol/x', arguments: {}, _meta: REQUEST_META },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(isMarkedEnvelopeViolation(error)).toBe(false)
  })

  test('an unknown prompt stays clear of the envelope marker', async () => {
    const error = await errorFor({
      method: 'prompts/get',
      params: { name: 'io.modelcontextprotocol/x', arguments: {}, _meta: REQUEST_META },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(isMarkedEnvelopeViolation(error)).toBe(false)
  })

  test('invalid prompt arguments stay clear of the envelope marker', async () => {
    const error = await errorFor({
      method: 'prompts/get',
      params: { name: 'greet', arguments: {}, _meta: REQUEST_META },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(error.message).toBe('Invalid prompt arguments')
    expect(isMarkedEnvelopeViolation(error)).toBe(false)
  })

  test('invalid tool input never becomes a JSON-RPC error at all', async () => {
    // The remaining `INVALID_PARAMS` thrower cannot be misclassified by the transport
    // because it never reaches the wire as an error: `tools/call` converts a handler
    // throw into a successful result carrying `isError` (SEP-1303). Pinned so that if
    // that conversion is ever removed, this file says what the transport must then handle.
    const body = await respondTo({
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'not-a-number' }, _meta: REQUEST_META },
    })
    expect(body.error).toBeUndefined()

    const invalid = await respondTo({
      method: 'tools/call',
      params: { name: 'echo', arguments: {}, _meta: REQUEST_META },
    })
    expect(invalid.error).toBeUndefined()
    expect(invalid.result?.isError).toBe(true)
    expect(invalid.result?.content?.[0]?.text).toBe('Invalid tool input')
  })
})
