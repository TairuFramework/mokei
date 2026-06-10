import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { describe, expect, test, vi } from 'vitest'

import { ContextClient } from '../src/index.js'
import * as traceModule from '../src/trace.js'
import { traceMetaFromContext } from '../src/trace.js'

describe('traceMetaFromContext', () => {
  test('returns an empty object when there is no active context', () => {
    expect(traceMetaFromContext(undefined)).toEqual({})
  })

  test('formats a W3C traceparent from an active context', () => {
    const meta = traceMetaFromContext({
      traceID: '0af7651916cd43dd8448eb211c80319c',
      spanID: '00f067aa0ba902b7',
      traceFlags: 1,
    })
    expect(meta).toEqual({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01',
    })
  })

  test('includes tracestate when a non-empty serialized value is provided', () => {
    const meta = traceMetaFromContext(
      { traceID: '0af7651916cd43dd8448eb211c80319c', spanID: '00f067aa0ba902b7', traceFlags: 1 },
      'vendor=value',
    )
    expect(meta.tracestate).toBe('vendor=value')
  })

  test('omits tracestate when the serialized value is empty', () => {
    const meta = traceMetaFromContext(
      { traceID: '0af7651916cd43dd8448eb211c80319c', spanID: '00f067aa0ba902b7', traceFlags: 1 },
      '',
    )
    expect('tracestate' in meta).toBe(false)
  })
})

describe('ContextClient.request trace injection', () => {
  test('merges current trace _meta into outgoing request params', async () => {
    vi.spyOn(traceModule, 'currentTraceMeta').mockReturnValue({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01',
    })
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({ transport: transports.client })

    // Calling any request lazily initializes the client, so drive the
    // initialize handshake before the tools/call frame can be read.
    client.initialize()
    await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: 0,
      result: {
        capabilities: {},
        protocolVersion: LATEST_PROTOCOL_VERSION,
        serverInfo: { name: 'Mokei', version: '0.1.0' },
      },
    })
    await transports.server.read()

    client.callTool({ name: 'x', arguments: {}, _meta: { foo: 'bar' } })
    const incoming = await transports.server.read()

    const params = (incoming as { value: { params?: { _meta?: Record<string, unknown> } } }).value
      .params
    expect(params?._meta).toMatchObject({
      foo: 'bar',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01',
    })

    await transports.dispose()
    vi.restoreAllMocks()
  })
})
