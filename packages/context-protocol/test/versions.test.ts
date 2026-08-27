import { createValidator } from '@sozai/schema'
import { describe, expect, test, vi } from 'vitest'

import {
  HEADER_MISMATCH,
  isSupportedProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  PROTOCOL_VERSIONS,
  PROTOCOLS,
  type ProtocolVersion,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '../src/index.js'
import { clientNotification as CLIENT_NOTIFICATION_2025_11_25 } from '../src/versions/2025-11-25.js'
import {
  clientNotification as CLIENT_NOTIFICATION_2026_07_28,
  PROTOCOL as PROTOCOL_2026_07_28,
} from '../src/versions/2026-07-28.js'

/**
 * Each revision's `clientNotification` union, keyed by revision. Imported from the version
 * modules rather than read off `ProtocolDefinition`, which carries only the whole-message
 * `clientMessage` union — a notification union is what `clientNotifications` has to agree with,
 * so the guard below compares against the union itself and not against a copy of it.
 */
const CLIENT_NOTIFICATION_UNIONS: Record<ProtocolVersion, { anyOf: ReadonlyArray<unknown> }> = {
  '2025-11-25': CLIENT_NOTIFICATION_2025_11_25,
  '2026-07-28': CLIENT_NOTIFICATION_2026_07_28,
}

/**
 * Every `method` const a notification union names, found by walking its members through the
 * `allOf`/`anyOf`/`oneOf` composition each notification schema is built from.
 */
function unionMethods(union: { anyOf: ReadonlyArray<unknown> }): Set<string> {
  const found = new Set<string>()
  const visit = (node: unknown): void => {
    if (node == null || typeof node !== 'object') {
      return
    }
    const record = node as Record<string, unknown>
    const properties = record.properties as Record<string, { const?: unknown }> | undefined
    if (typeof properties?.method?.const === 'string') {
      found.add(properties.method.const)
    }
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = record[key]
      if (Array.isArray(branches)) {
        for (const branch of branches) {
          visit(branch)
        }
      }
    }
  }
  for (const member of union.anyOf) {
    visit(member)
  }
  return found
}

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

  test('2026-07-28 gates subscriptions/listen as a client method', () => {
    expect(PROTOCOLS['2026-07-28'].clientMethods.has('subscriptions/listen')).toBe(true)
  })

  // `requiresHandshake` and `requiresPerRequestLogLevel` are both strict functions of
  // `clientMethods`, and drift between them fails silently: a revision that drops
  // `logging/setLevel` while leaving `requiresPerRequestLogLevel: false` makes `ContextServer`
  // discard every `notifications/message` for the lifetime of the connection, with no error
  // anywhere. Asserted over every registered revision so a new one cannot land inconsistent.
  test('the derivable flags and notification stamping match their method table on every revision', () => {
    for (const version of PROTOCOL_VERSIONS) {
      const protocol = PROTOCOLS[version]
      expect(protocol.requiresHandshake, version).toBe(protocol.clientMethods.has('initialize'))
      expect(protocol.requiresPerRequestLogLevel, version).toBe(
        !protocol.clientMethods.has('logging/setLevel'),
      )
      // A revision whose peer routes on per-request `_meta` routes notifications on it too, so
      // `decorateNotification` must stamp the version exactly when `requiresRequestMeta` is set —
      // and stamp nothing else, since the request envelope does not belong on a notification.
      expect(protocol.decorateNotification({ requestId: 1 }), version).toEqual(
        protocol.requiresRequestMeta
          ? { requestId: 1, _meta: { 'io.modelcontextprotocol/protocolVersion': version } }
          : { requestId: 1 },
      )
    }
  })

  // `clientNotifications` is what `ContextClient.notify()` gates on, and the `clientMessage`
  // union is what the peer validates the resulting frame against. Drift either way is silent:
  // a name in the set the union rejects sends a frame a conformant peer refuses, and a union
  // member missing from the set is refused locally though the peer would have taken it. Driven
  // off the union rather than a hand-copied list, so a revision that changes one and not the
  // other fails here.
  test('clientNotifications names exactly the members of its own notification union', () => {
    for (const version of PROTOCOL_VERSIONS) {
      const declared = [...PROTOCOLS[version].clientNotifications].sort()
      expect(declared, version).toEqual(
        [...unionMethods(CLIENT_NOTIFICATION_UNIONS[version])].sort(),
      )
    }
  })

  // The behavioural half of the same guard: a name the set declares has to produce a frame the
  // revision's *own* `clientMessage` validator accepts, and a name it does not declare has to
  // produce one that validator rejects. The undeclared names are taken from every other
  // registered revision's union rather than hardcoded, so this stays honest as revisions come
  // and go — with the set-equality test above, that covers union ⊄ set for every name, not just
  // for a list somebody remembered to update.
  test('every declared client notification validates, and no undeclared one does', () => {
    // The minimum params each notification's own schema requires; anything not listed has none.
    const required: Record<string, Record<string, unknown>> = {
      'notifications/cancelled': { requestId: 1 },
      'notifications/progress': { progressToken: 1, progress: 0 },
    }
    const everyKnownMethod = new Set(
      PROTOCOL_VERSIONS.flatMap((version) => [
        ...unionMethods(CLIENT_NOTIFICATION_UNIONS[version]),
      ]),
    )

    for (const version of PROTOCOL_VERSIONS) {
      const protocol = PROTOCOLS[version]
      const validate = createValidator(protocol.clientMessage)
      for (const method of protocol.clientNotifications) {
        const frame = {
          jsonrpc: '2.0',
          method,
          params: protocol.decorateNotification(required[method] ?? {}),
        }
        expect(validate(frame).issues, `${version} rejects declared ${method}`).toBeUndefined()
      }
      const undeclared = [...everyKnownMethod].filter(
        (method) => !protocol.clientNotifications.has(method),
      )
      for (const method of undeclared) {
        const frame = {
          jsonrpc: '2.0',
          method,
          params: protocol.decorateNotification(required[method] ?? {}),
        }
        expect(validate(frame).issues, `${version} admits undeclared ${method}`).toBeDefined()
      }
    }
  })

  test('2025-11-25 leaves requests and results untouched', () => {
    const protocol = PROTOCOLS['2025-11-25']
    const params = { name: 'echo' }
    expect(protocol.decorateRequest(params, { capabilities: {} })).toEqual(params)
    expect(protocol.decorateNotification({ requestId: 7 })).toEqual({ requestId: 7 })
    expect(protocol.wrapResult({ tools: [] }, { serverInfo: { name: 't', version: '1' } })).toEqual(
      { tools: [] },
    )
    expect(
      protocol.readRequestMeta({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    ).toEqual({})
  })
})

describe('per-version message validation', () => {
  // Ajv reports strict-mode violations through `console.warn`, which on a stdio MCP server is
  // the log channel the host captures — so a schema that trips `strictTypes` prints protocol
  // internals over every server's own logs at startup.
  test('building the validators emits no strict-mode warnings', () => {
    // Reached through `globalThis` rather than the bare `console` global: this package's tests
    // compile without DOM or Node type libs.
    const logger = (
      globalThis as unknown as { console: { warn: (...args: Array<unknown>) => void } }
    ).console
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      for (const version of PROTOCOL_VERSIONS) {
        createValidator(PROTOCOLS[version].clientMessage)
        createValidator(PROTOCOLS[version].serverMessage)
      }
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

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

  test('2026-07-28 accepts a subscriptions/listen request carrying protocol _meta', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].clientMessage)
    expect(
      validate({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscriptions/listen',
        params: {
          notifications: { toolsListChanged: true },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }).issues,
    ).toBeUndefined()
  })

  test('2026-07-28 accepts notifications/subscriptions/acknowledged', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].serverMessage)
    expect(
      validate({
        jsonrpc: '2.0',
        method: 'notifications/subscriptions/acknowledged',
        params: { notifications: { toolsListChanged: true } },
      }).issues,
    ).toBeUndefined()
  })

  // No `resultType` here, unlike every other terminal result on this revision: the terminal
  // `subscriptions/listen` response is sent once, on graceful teardown of the stream, and Task 1's
  // schema deliberately excludes `resultType` from it.
  test('2026-07-28 accepts a subscriptions/listen terminal result with no resultType', () => {
    const validate = createValidator(PROTOCOLS['2026-07-28'].serverMessage)
    expect(
      validate({
        jsonrpc: '2.0',
        id: 1,
        result: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'sub-1' } },
      }).issues,
    ).toBeUndefined()
  })
})
