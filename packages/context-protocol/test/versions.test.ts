import { describe, expect, test } from 'vitest'

import {
  HEADER_MISMATCH,
  isSupportedProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  PROTOCOL_VERSIONS,
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
