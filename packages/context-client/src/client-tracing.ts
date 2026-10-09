import type { RequestID } from '@mokei/context-protocol'
import type { Context, Link, Span } from '@opentelemetry/api'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { createTracerFactory, extractW3CTraceContext } from '@sozai/otel'

import {
  capturePayload,
  type PayloadCapture,
  requestAttributes,
  requestSpanName,
  responseOutcome,
} from './observation.js'

export type TerminationReason = 'stopped' | 'lost'
export type ClientTracing = {
  contextID: string
  contextSpan?: Span
  /** Payload capture is opt-in. Defaults to 'off'. */
  payloads?: PayloadCapture
  /** Read the current negotiated session at request start. */
  getSessionID?: () => string | undefined
}
export type ExchangeSpan = {
  span: Span
  context: Context
  setID(id: RequestID): void
  succeed(result: unknown): void
  fail(errorType: string, message?: string): void
}

const createTracer = createTracerFactory('mokei')

export function createExchangeTracer(getBinding: () => ClientTracing | undefined) {
  const open = new Set<ExchangeSpan>()
  function start(
    method: string,
    params: unknown,
    direction: 'client' | 'server',
    parent: Context,
    links: Array<Link>,
    id?: RequestID,
    contextTraceID?: string,
  ): ExchangeSpan {
    const binding = getBinding()
    const span = createTracer('context-client').startSpan(
      requestSpanName(method),
      {
        kind: direction === 'client' ? SpanKind.CLIENT : SpanKind.SERVER,
        links,
        // The no-op tracer never reads attributes. SDK processors receive payloads at start.
        get attributes() {
          return {
            ...requestAttributes({
              method,
              params,
              id,
              direction,
              contextID: binding?.contextID,
              sessionID: binding?.getSessionID?.(),
              capture: binding?.payloads,
            }),
            ...(contextTraceID === undefined ? {} : { 'mokei.context.trace_id': contextTraceID }),
          }
        },
      },
      parent,
    )
    let settled = false
    function finish(errorType?: string, message?: string) {
      settled = true
      open.delete(exchange)
      if (errorType !== undefined) span.setAttribute('error.type', errorType)
      span.setStatus({
        code: errorType === undefined ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message,
      })
      span.end()
    }
    const exchange: ExchangeSpan = {
      span,
      context: trace.setSpan(parent, span),
      setID(id) {
        if (!settled) span.setAttribute('jsonrpc.request.id', String(id))
      },
      succeed(result) {
        if (settled) return
        if (span.isRecording()) {
          const captured = capturePayload(result, binding?.payloads)
          span.addEvent(
            'mcp.response',
            captured === undefined
              ? {}
              : {
                  payload: captured.payload,
                  ...(captured.truncated ? { 'mokei.payload.truncated': true } : {}),
                },
          )
        }
        const outcome = responseOutcome({ result })
        finish(outcome.error ? outcome.errorType : undefined)
      },
      fail(errorType, message) {
        if (!settled) finish(errorType, message)
      },
    }
    open.add(exchange)
    return exchange
  }
  return {
    startOutgoing(
      method: string,
      params: unknown,
      options?: { links?: Array<Link> },
    ): ExchangeSpan {
      const binding = getBinding()
      let parent = context.active()
      const active = trace.getSpan(parent)
      const links = [...(options?.links ?? [])]
      let contextTraceID: string | undefined
      if (binding?.contextSpan !== undefined) {
        const bound = binding.contextSpan.spanContext()
        if (active === undefined) parent = trace.setSpan(parent, binding.contextSpan)
        else if (
          active.spanContext().spanId !== bound.spanId ||
          active.spanContext().traceId !== bound.traceId
        ) {
          links.push({ context: bound })
          contextTraceID = bound.traceId
        }
      }
      return start(method, params, 'client', parent, links, undefined, contextTraceID)
    },
    startIncoming(
      method: string,
      params: unknown,
      id: RequestID,
      meta?: Record<string, unknown>,
    ): ExchangeSpan {
      const bound = getBinding()?.contextSpan
      const parent = bound === undefined ? ROOT_CONTEXT : trace.setSpan(ROOT_CONTEXT, bound)
      const remote = meta === undefined ? undefined : extractW3CTraceContext(meta)
      const remoteContext = remote === undefined ? undefined : trace.getSpanContext(remote)
      return start(
        method,
        params,
        'server',
        parent,
        remoteContext === undefined ? [] : [{ context: remoteContext }],
        id,
      )
    },
    settleAll(reason: TerminationReason): void {
      for (const exchange of open) exchange.fail(`context.${reason}`)
    },
  }
}
