import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import {
  HEADER_MISMATCH,
  isSupportedProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  PROTOCOL_VERSIONS,
  PROTOCOLS,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '../src/index.js'
import { PROTOCOL as PROTOCOL_2026_07_28 } from '../src/versions/2026-07-28.js'

describe('protocol versions', () => {
  test('lists both supported revisions, newest first', () => {
    expect(PROTOCOL_VERSIONS).toEqual(['2026-07-28', '2025-11-25'])
    expect(LATEST_PROTOCOL_VERSION).toBe('2026-07-28')
  })

  test('recognises supported revisions only', () => {
    expect(isSupportedProtocolVersion('2026-07-28')).toBe(true)
    expect(isSupportedProtocolVersion('2025-11-25')).toBe(true)
    expect(isSupportedProtocolVersion('1900-01-01')).toBe(false)
  })

  test('allocates the spec-reserved error codes', () => {
    expect(HEADER_MISMATCH).toBe(-32020)
    expect(MISSING_REQUIRED_CLIENT_CAPABILITY).toBe(-32021)
    expect(UNSUPPORTED_PROTOCOL_VERSION).toBe(-32022)
  })
})

describe('2026-07-28 envelope', () => {
  test('decorateRequest adds the required protocol _meta', () => {
    const params = PROTOCOL_2026_07_28.decorateRequest(
      { name: 'echo', arguments: { text: 'hi' } },
      { capabilities: {}, clientInfo: { name: 'Mokei', version: '0.4.0' } },
    ) as Record<string, Record<string, unknown>>
    expect(params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28')
    expect(params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({})
    expect(params._meta['io.modelcontextprotocol/clientInfo']).toEqual({
      name: 'Mokei',
      version: '0.4.0',
    })
    expect(params.name).toBe('echo')
  })

  test('decorateRequest preserves existing _meta such as trace context', () => {
    const params = PROTOCOL_2026_07_28.decorateRequest(
      { _meta: { traceparent: '00-abc-def-01' } },
      { capabilities: {}, logLevel: 'debug' },
    ) as Record<string, Record<string, unknown>>
    expect(params._meta.traceparent).toBe('00-abc-def-01')
    expect(params._meta['io.modelcontextprotocol/logLevel']).toBe('debug')
  })

  test('readRequestMeta reads the protocol fields back', () => {
    const info = PROTOCOL_2026_07_28.readRequestMeta({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': { sampling: {} },
          'io.modelcontextprotocol/logLevel': 'warning',
        },
      },
    })
    expect(info.protocolVersion).toBe('2026-07-28')
    expect(info.clientCapabilities).toEqual({ sampling: {} })
    expect(info.logLevel).toBe('warning')
    expect(info.clientInfo).toBeUndefined()
  })

  test('wrapResult adds resultType and serverInfo', () => {
    const result = PROTOCOL_2026_07_28.wrapResult(
      { tools: [] },
      { serverInfo: { name: 'test', version: '1.0.0' } },
    ) as Record<string, unknown> & { _meta: Record<string, unknown> }
    expect(result.resultType).toBe('complete')
    expect(result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
      name: 'test',
      version: '1.0.0',
    })
    expect(result.tools).toEqual([])
  })
})

describe('protocol records', () => {
  test('2025-11-25 keeps ping, initialize and logging/setLevel', () => {
    const protocol = PROTOCOLS['2025-11-25']
    expect(protocol.requiresHandshake).toBe(true)
    expect(protocol.requiresRequestMeta).toBe(false)
    expect(protocol.requiresCacheHints).toBe(false)
    expect(protocol.requiresPerRequestLogLevel).toBe(false)
    expect(protocol.clientMethods.has('ping')).toBe(true)
    expect(protocol.clientMethods.has('initialize')).toBe(true)
    expect(protocol.clientMethods.has('logging/setLevel')).toBe(true)
    expect(protocol.clientMethods.has('server/discover')).toBe(false)
    expect(protocol.serverMethods.has('sampling/createMessage')).toBe(true)
  })

  test('2026-07-28 drops ping, initialize and logging/setLevel, adds server/discover', () => {
    const protocol = PROTOCOLS['2026-07-28']
    expect(protocol.requiresHandshake).toBe(false)
    expect(protocol.requiresRequestMeta).toBe(true)
    expect(protocol.requiresCacheHints).toBe(true)
    expect(protocol.requiresPerRequestLogLevel).toBe(true)
    expect(protocol.clientMethods.has('ping')).toBe(false)
    expect(protocol.clientMethods.has('initialize')).toBe(false)
    expect(protocol.clientMethods.has('logging/setLevel')).toBe(false)
    expect(protocol.clientMethods.has('server/discover')).toBe(true)
    expect(protocol.clientMethods.has('tools/call')).toBe(true)
    expect(protocol.serverMethods.size).toBe(0)
  })

  test('2025-11-25 leaves requests and results untouched', () => {
    const protocol = PROTOCOLS['2025-11-25']
    const params = { name: 'echo' }
    expect(protocol.decorateRequest(params, { capabilities: {} })).toEqual(params)
    expect(protocol.wrapResult({ tools: [] }, { serverInfo: { name: 't', version: '1' } })).toEqual(
      { tools: [] },
    )
    expect(
      protocol.readRequestMeta({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    ).toEqual({})
  })
})

describe('per-version message validation', () => {
  test('2026-07-28 rejects a request without protocol _meta', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].clientMessage)
    expect(
      validate({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }).issues,
    ).toBeDefined()
  })

  test('2026-07-28 accepts a request carrying protocol _meta', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].clientMessage)
    const outcome = validate({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    })
    expect(outcome.issues).toBeUndefined()
  })

  test('2025-11-25 accepts a request with no protocol _meta', () => {
    const validate = createValidator(PROTOCOLS['2025-11-25'].clientMessage)
    expect(
      validate({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }).issues,
    ).toBeUndefined()
  })

  test('2026-07-28 rejects notifications/initialized', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].clientMessage)
    expect(validate({ jsonrpc: '2.0', method: 'notifications/initialized' }).issues).toBeDefined()
  })

  test('2026-07-28 rejects notifications/roots/list_changed', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].clientMessage)
    expect(
      validate({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' }).issues,
    ).toBeDefined()
  })

  test('2026-07-28 still accepts notifications/cancelled', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].clientMessage)
    expect(
      validate({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })
        .issues,
    ).toBeUndefined()
  })

  test('2025-11-25 still accepts notifications/initialized and notifications/roots/list_changed', () => {
    const validate = createValidator(PROTOCOLS['2025-11-25'].clientMessage)
    expect(validate({ jsonrpc: '2.0', method: 'notifications/initialized' }).issues).toBeUndefined()
    expect(
      validate({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' }).issues,
    ).toBeUndefined()
  })

  test('2026-07-28 rejects notifications/elicitation/complete', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].serverMessage)
    expect(
      validate({
        jsonrpc: '2.0',
        method: 'notifications/elicitation/complete',
        params: { elicitationId: 'abc' },
      }).issues,
    ).toBeDefined()
  })

  test('2026-07-28 still accepts notifications/message', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].serverMessage)
    expect(
      validate({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: 'hi' },
      }).issues,
    ).toBeUndefined()
  })

  test('2025-11-25 still accepts notifications/elicitation/complete', () => {
    const validate = createValidator(PROTOCOLS['2025-11-25'].serverMessage)
    expect(
      validate({
        jsonrpc: '2.0',
        method: 'notifications/elicitation/complete',
        params: { elicitationId: 'abc' },
      }).issues,
    ).toBeUndefined()
  })
})
