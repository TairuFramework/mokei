import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import {
  INVALID_PARAMS,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
} from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import { ContextServer } from '../src/index.js'

// The HTTP transport keys its `400` mapping off these messages naming their `_meta` key
// (`packages/http-server/src/stateless.ts`, `isEnvelopeFailure`). Changing the wording here
// silently turns those `400`s into `200`s, so pin it.

/** Sends one request to a `2026-07-28`-only server and returns the JSON-RPC error it answers. */
async function errorFor(
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
): Promise<{ code: number; message: string }> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  new ContextServer({
    name: 'envelope-test',
    version: '0.0.0',
    protocolVersions: ['2026-07-28'],
    tools: {
      echo: {
        description: 'Echo input',
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
        handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      },
    },
    transport: transports.server,
  })
  transports.client.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ClientRequest)
  const read = await transports.client.read()
  await transports.dispose()
  return (read.value as unknown as { error: { code: number; message: string } }).error
}

describe('envelope failure messages', () => {
  test('name the _meta key they are about', () => {
    expect(META_PROTOCOL_VERSION).toBe('io.modelcontextprotocol/protocolVersion')
    expect(META_CLIENT_CAPABILITIES).toBe('io.modelcontextprotocol/clientCapabilities')
    expect(INVALID_PARAMS).toBe(-32602)
  })

  test('a missing protocol version names its _meta key', async () => {
    const error = await errorFor({ method: 'tools/list', params: {} })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(error.message).toContain(META_PROTOCOL_VERSION)
  })

  test('missing client capabilities names its _meta key', async () => {
    const error = await errorFor({
      method: 'tools/list',
      params: { _meta: { [META_PROTOCOL_VERSION]: '2026-07-28' } },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(error.message).toContain(META_CLIENT_CAPABILITIES)
  })

  test('an unknown tool raises the same code without naming a _meta key', async () => {
    // The other half of the coupling: this error shares `INVALID_PARAMS` with the two above
    // but is an ordinary application failure, so its message must stay clear of the
    // `io.modelcontextprotocol/` namespace the transport tests for.
    const error = await errorFor({
      method: 'tools/call',
      params: {
        name: 'nope',
        arguments: {},
        _meta: {
          [META_PROTOCOL_VERSION]: '2026-07-28',
          [META_CLIENT_CAPABILITIES]: {},
        },
      },
    })
    expect(error.code).toBe(INVALID_PARAMS)
    expect(error.message).not.toContain('io.modelcontextprotocol/')
  })
})
