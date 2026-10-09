import {
  capturePayload,
  type MessageDirection,
  type PayloadCapture,
  redactCommandArgs,
  requestAttributes,
  requestSpanName,
  responseOutcome,
  type TerminationReason,
} from '@mokei/context-client'
import { getMokeiLogger } from '@mokei/logger'
import type { Span } from '@opentelemetry/api'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { createTracerFactory, extractW3CTraceContext } from '@sozai/otel'

const createTracer = createTracerFactory('mokei')

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isID(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

function requestKey(direction: MessageDirection, id: string | number): string {
  return JSON.stringify([direction, typeof id, id])
}

export function createProxyTracing(params: {
  contextID: string
  command: string
  args: Array<string>
  payloads?: PayloadCapture
}): {
  observe(from: MessageDirection, message: unknown): void
  end(reason: TerminationReason): void
} {
  const tracer = createTracer('host-node')
  const contextSpan = tracer.startSpan(
    'mcp.context',
    {
      attributes: {
        'mokei.kind': 'context',
        'mokei.root': true,
        'mokei.context.id': params.contextID,
        'mcp.transport': 'stdio',
        'process.command': params.command,
        'process.command_args': redactCommandArgs(params.args),
      },
    },
    ROOT_CONTEXT,
  )
  const parent = trace.setSpan(ROOT_CONTEXT, contextSpan)
  const open = new Map<string, Span>()
  let ended = false
  function finish(key: string, errorType?: string): void {
    const span = open.get(key)
    if (span === undefined) return
    open.delete(key)
    if (errorType !== undefined) span.setAttribute('error.type', errorType)
    span.setStatus({ code: errorType === undefined ? SpanStatusCode.OK : SpanStatusCode.ERROR })
    span.end()
  }
  return {
    observe(from, message) {
      if (ended || !isRecord(message)) return
      if (typeof message.method === 'string') {
        if (isID(message.id)) {
          const method = message.method
          const id = message.id
          const key = requestKey(from, id)
          if (open.has(key)) return
          const meta = isRecord(message.params) ? message.params._meta : undefined
          const remote = isRecord(meta) ? extractW3CTraceContext(meta) : undefined
          const remoteContext = remote === undefined ? undefined : trace.getSpanContext(remote)
          open.set(
            key,
            tracer.startSpan(
              requestSpanName(method),
              {
                kind: from === 'client' ? SpanKind.CLIENT : SpanKind.SERVER,
                links: remoteContext === undefined ? [] : [{ context: remoteContext }],
                get attributes() {
                  return requestAttributes({
                    method,
                    params: message.params,
                    id,
                    direction: from,
                    contextID: params.contextID,
                    capture: params.payloads,
                  })
                },
              },
              parent,
            ),
          )
        } else if (message.id == null) {
          context.with(parent, () => {
            const captured =
              message.params === undefined || !contextSpan.isRecording()
                ? undefined
                : capturePayload(message.params, params.payloads)
            getMokeiLogger('mcp')
              .getChild('notification')
              .debug('MCP notification {method}', {
                method: message.method,
                direction: from,
                ...(captured === undefined ? {} : { payload: captured.payload }),
                ...(captured?.truncated ? { 'mokei.payload.truncated': true } : {}),
              })
          })
          if (
            message.method === 'notifications/cancelled' &&
            isRecord(message.params) &&
            isID(message.params.requestId)
          ) {
            finish(requestKey(from, message.params.requestId), 'cancelled')
          }
        }
      } else if (isID(message.id) && ('result' in message || 'error' in message)) {
        const key = requestKey(from === 'client' ? 'server' : 'client', message.id)
        const span = open.get(key)
        if (span === undefined) return
        if (span.isRecording()) {
          const captured = capturePayload(
            'result' in message ? message.result : message.error,
            params.payloads,
          )
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
        const error =
          isRecord(message.error) && typeof message.error.code === 'number'
            ? { code: message.error.code }
            : undefined
        const outcome = responseOutcome({ result: message.result, error })
        finish(key, outcome.error ? outcome.errorType : undefined)
      }
    },
    end(reason) {
      if (ended) return
      ended = true
      for (const key of open.keys()) finish(key, `context.${reason}`)
      if (reason === 'lost') contextSpan.setAttribute('error.type', 'context.lost')
      contextSpan.setStatus({ code: reason === 'lost' ? SpanStatusCode.ERROR : SpanStatusCode.OK })
      contextSpan.end()
    },
  }
}
