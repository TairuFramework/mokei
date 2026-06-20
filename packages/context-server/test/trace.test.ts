import { AsyncLocalStorage } from 'node:async_hooks'
import { formatTraceparent, getActiveBaggage, getActiveTraceContext } from '@enkaku/otel'
import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import type { Context } from '@opentelemetry/api'
import { context, ROOT_CONTEXT } from '@opentelemetry/api'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ContextServer, createTool } from '../src/index.js'
import { activeContextFromMeta, baggageEntriesFromMeta, withRequestMeta } from '../src/trace.js'

// Register a minimal AsyncLocalStorage-based context manager so context.with() +
// context.active() propagate both synchronously and across await boundaries in tests.
// Without this, OTel's default NoopContextManager ignores the context passed to
// context.with(), so getActiveTraceContext() always returns undefined.
const storage = new AsyncLocalStorage<Context>()

beforeAll(() => {
  context.setGlobalContextManager({
    active: () => storage.getStore() ?? ROOT_CONTEXT,
    with: (
      ctx: Context,
      fn: (...args: Array<unknown>) => unknown,
      thisArg?: unknown,
      ...args: Array<unknown>
    ) => storage.run(ctx, () => fn.call(thisArg, ...args)),
    bind: <T>(_ctx: Context, target: T): T => target,
    enable() {
      return this
    },
    disable() {
      return this
    },
  })
})

afterAll(() => {
  context.disable()
})

// ─── Test fixture ────────────────────────────────────────────────────────────
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = '00f067aa0ba902b7'
const TRACE_FLAGS = 1
const TRACEPARENT = formatTraceparent(TRACE_ID, SPAN_ID, TRACE_FLAGS)

// ─── activeContextFromMeta ────────────────────────────────────────────────────

describe('activeContextFromMeta', () => {
  test('returns undefined when meta is undefined', () => {
    expect(activeContextFromMeta(undefined)).toBeUndefined()
  })

  test('returns undefined when meta has no traceparent', () => {
    expect(activeContextFromMeta({})).toBeUndefined()
  })

  test('returns a defined Context when meta carries a valid traceparent', () => {
    const ctx = activeContextFromMeta({ traceparent: TRACEPARENT })
    expect(ctx).toBeDefined()
  })
})

// ─── baggageEntriesFromMeta ───────────────────────────────────────────────────

describe('baggageEntriesFromMeta', () => {
  test('returns [] when meta is undefined', () => {
    expect(baggageEntriesFromMeta(undefined)).toEqual([])
  })

  test('returns [] when meta has no baggage key', () => {
    expect(baggageEntriesFromMeta({})).toEqual([])
  })

  test('returns [] when baggage value is not a string', () => {
    expect(baggageEntriesFromMeta({ baggage: 42 })).toEqual([])
  })

  test('parses entries from a valid baggage string', () => {
    const entries = baggageEntriesFromMeta({ baggage: 'userId=abc' })
    expect(entries).toEqual([{ key: 'userId', value: 'abc' }])
  })
})

// ─── withRequestMeta ──────────────────────────────────────────────────────────

describe('withRequestMeta', () => {
  test('runs fn and returns its value when meta is undefined', () => {
    const result = withRequestMeta(undefined, () => 42)
    expect(result).toBe(42)
  })

  test('activates trace context inside fn from a valid traceparent', () => {
    let capturedTraceID: string | undefined
    withRequestMeta({ traceparent: TRACEPARENT }, () => {
      capturedTraceID = getActiveTraceContext()?.traceID
    })
    expect(capturedTraceID).toBe(TRACE_ID)
  })

  test('activates baggage inside fn when both traceparent and baggage are present', () => {
    let capturedBaggage: ReturnType<typeof getActiveBaggage>
    withRequestMeta({ traceparent: TRACEPARENT, baggage: 'userId=abc' }, () => {
      capturedBaggage = getActiveBaggage()
    })
    expect(capturedBaggage).toEqual([{ key: 'userId', value: 'abc' }])
  })
})

// ─── Server-level: inbound trace propagation ─────────────────────────────────

describe('ContextServer – inbound trace propagation', () => {
  test('tool handler observes active trace context from request _meta', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    let observedTraceID: string | undefined

    new ContextServer({
      name: 'test',
      version: '0.0.0',
      transport: transports.server,
      tools: {
        probe: createTool('probe context', { type: 'object' }, async () => {
          // Reads the OTel active context — will only be defined if withRequestMeta
          // correctly activated the remote span context on the way in.
          observedTraceID = getActiveTraceContext()?.traceID
          return { content: [{ type: 'text', text: 'ok' }] }
        }),
      },
    })

    transports.client.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'probe',
        arguments: {},
        _meta: { traceparent: TRACEPARENT },
      },
    } as ClientRequest)

    // Wait for the tools/call response to ensure the handler has completed.
    await transports.client.read()

    expect(observedTraceID).toBe(TRACE_ID)

    await transports.dispose()
  })
})
