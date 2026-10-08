import { describe, expect, test } from 'vitest'

import {
  capturePayload,
  redactPayload,
  requestAttributes,
  responseOutcome,
  sanitizeMessage,
} from '../src/observation.js'

describe('MCP observation', () => {
  test('redactPayload drops non-allow-listed _meta keys', () => {
    expect(
      redactPayload({
        _meta: {
          traceparent: 't',
          baggage: 'b',
          tracestate: 's',
          'dev.mokei/flow-run': 'r',
          'dev.mokei/grant': 'g',
        },
        a: 1,
      }),
    ).toEqual({ _meta: { traceparent: 't', 'dev.mokei/flow-run': 'r' }, a: 1 })
  })

  test('redactPayload replaces secret-pattern keys at any depth, through arrays', () => {
    expect(
      redactPayload({
        env: { GITHUB_TOKEN: 'x' },
        headers: [{ name: 'n', apiKey: 'k' }],
        Authorization: 'Bearer y',
        nested: { 'api-key': 'z', client_secret: 'w' },
        Cookie: 'session=x',
        deep: { credentials: 'user:password' },
      }),
    ).toEqual({
      env: { GITHUB_TOKEN: '[redacted]' },
      headers: [{ name: 'n', apiKey: '[redacted]' }],
      Authorization: '[redacted]',
      nested: { 'api-key': '[redacted]', client_secret: '[redacted]' },
      Cookie: '[redacted]',
      deep: { credentials: '[redacted]' },
    })
  })

  test('capturePayload honours on, off and byte caps', () => {
    expect(capturePayload({ a: 1 }, 'off')).toBeUndefined()
    expect(capturePayload({ a: 1 }, 'on')).toEqual({ payload: '{"a":1}', truncated: false })
    const big = { data: 'x'.repeat(70000) }
    const on = capturePayload(big, 'on')
    expect(on?.truncated).toBe(true)
    expect(new TextEncoder().encode(on?.payload).length).toBeLessThanOrEqual(65536)
    expect(capturePayload(big, 100)?.payload.length).toBeLessThanOrEqual(100)
  })

  test('capturePayload never splits a surrogate pair', () => {
    const out = capturePayload({ s: '😀'.repeat(50) }, 41)
    expect(out?.payload).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  test('requestAttributes maps a tools/call request', () => {
    expect(
      requestAttributes({
        method: 'tools/call',
        params: { name: 'search', arguments: { q: 1 } },
        id: 7,
        direction: 'client',
        contextID: 'c1',
        sessionID: 's1',
        capture: 'on',
      }),
    ).toEqual({
      'mokei.kind': 'mcp',
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'search',
      'jsonrpc.request.id': '7',
      'mokei.direction': 'client',
      'mokei.context.id': 'c1',
      'mcp.session.id': 's1',
      'mokei.mcp.request': '{"name":"search","arguments":{"q":1}}',
    })
  })

  test('requestAttributes sets mokei.payload.truncated when the request is cut', () => {
    expect(
      requestAttributes({
        method: 'tools/call',
        params: { s: 'x'.repeat(200) },
        direction: 'client',
        capture: 50,
      })['mokei.payload.truncated'],
    ).toBe(true)
  })

  test('responseOutcome maps JSON-RPC errors and tool errors', () => {
    expect(responseOutcome({ result: {} })).toEqual({ error: false })
    expect(responseOutcome({ error: { code: -32602 } })).toEqual({
      error: true,
      errorType: '-32602',
    })
    expect(responseOutcome({ result: { isError: true } })).toEqual({
      error: true,
      errorType: 'tool_error',
    })
  })

  test('sanitizeMessage redacts and caps, and reduces to the envelope when off', () => {
    const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { token: 't' } }
    expect(sanitizeMessage(message, 'on')).toEqual({ ...message, params: { token: '[redacted]' } })
    expect(sanitizeMessage(message, 'off')).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
    expect(message.params.token).toBe('t')
  })

  test('sanitizeMessage redacts and caps JSON-RPC error data', () => {
    const message = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'failure', data: { token: 't', detail: 'x'.repeat(100) } },
    }

    const sanitised = sanitizeMessage(message, 40) as typeof message & {
      error: { code: number; message: string; data: string }
      'dev.mokei/truncated': true
    }
    expect(sanitised.error.code).toBe(-32603)
    expect(sanitised.error.message).toBe('failure')
    expect(sanitised.error.data).toContain('[redacted]')
    expect(sanitised.error.data.length).toBeLessThanOrEqual(40)
    expect(sanitised['dev.mokei/truncated']).toBe(true)
    expect(message.error.data.token).toBe('t')
  })

  test('sanitizeMessage keeps only JSON-RPC error code and message when capture is off', () => {
    expect(
      sanitizeMessage(
        {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'failure', data: { token: 't' } },
        },
        'off',
      ),
    ).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'failure' } })
  })
})
