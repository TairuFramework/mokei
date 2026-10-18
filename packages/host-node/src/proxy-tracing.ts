import {
  capturePayload,
  endSpanError,
  getMokeiTracer,
  type MessageDirection,
  mcpMetricsEnabled,
  metricAttributes,
  type PayloadCapture,
  recordMCPOperation,
  recordMCPSession,
  redactCommandArgs,
  requestAttributes,
  requestSpanName,
  resolveContentCapture,
  responseAttributes,
  responseOutcome,
  settleAttributes,
  type TerminationReason,
  type TraceParentFrom,
} from '@mokei/context-client'
import { isInputRequiredResult } from '@mokei/context-protocol'
import { getMokeiLogger } from '@mokei/logger'
import type { Span } from '@opentelemetry/api'
import { context, ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api'
import { extractW3CTraceContext } from '@sozai/otel'

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
  parentFrom?: TraceParentFrom
}): {
  observe(from: MessageDirection, message: unknown): void
  end(reason: TerminationReason): void
} {
  const tracer = getMokeiTracer('host-node')
  const capture = resolveContentCapture(params.payloads)
  const contextSpan = tracer.startSpan(
    'mcp.context',
    {
      attributes: {
        'mokei.kind': 'context',
        'mokei.root': true,
        'mokei.context.id': params.contextID,
        'network.transport': 'pipe',
        'mokei.context.transport': 'stdio',
        'process.command': params.command,
        'process.command_args': redactCommandArgs(params.args),
      },
    },
    ROOT_CONTEXT,
  )
  const parent = trace.setSpan(ROOT_CONTEXT, contextSpan)
  const open = new Map<
    string,
    {
      span: Span
      method: string
      params: unknown
      side: MessageDirection
      startedAt: number
      proxied: boolean
    }
  >()
  const startedAt = performance.now()
  let protocolVersion: string | undefined
  let ended = false
  function finish(
    key: string,
    errorType?: string,
    message?: string,
    statusCode?: string,
    inputRequired = false,
  ): void {
    const entry = open.get(key)
    if (entry === undefined) return
    open.delete(key)
    // Proxied calls are measured by the traced caller; recording here would double count.
    if (mcpMetricsEnabled() && !entry.proxied)
      recordMCPOperation({
        side: entry.side,
        durationS: (performance.now() - entry.startedAt) / 1000,
        attributes: metricAttributes({
          ...requestAttributes({
            method: entry.method,
            params: entry.params,
            direction: entry.side,
            capture: 'off',
            protocolVersion,
            network: { transport: 'pipe' },
          }),
          ...(errorType === undefined ? {} : { 'error.type': errorType }),
          ...(statusCode === undefined ? {} : { 'rpc.response.status_code': statusCode }),
        }),
      })
    entry.span.setAttributes(settleAttributes({ method: entry.method, inputRequired }))
    if (statusCode !== undefined) entry.span.setAttribute('rpc.response.status_code', statusCode)
    if (errorType === undefined) entry.span.end()
    else endSpanError(entry.span, errorType, message)
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
          const fromMeta =
            params.parentFrom === 'meta' && remote !== undefined && remoteContext !== undefined
          open.set(key, {
            method,
            params: message.params,
            side: from,
            startedAt: performance.now(),
            proxied: remoteContext !== undefined,
            span: tracer.startSpan(
              requestSpanName(method, message.params),
              {
                kind: from === 'client' ? SpanKind.CLIENT : SpanKind.SERVER,
                links: fromMeta
                  ? [{ context: contextSpan.spanContext() }]
                  : remoteContext === undefined
                    ? []
                    : [{ context: remoteContext }],
                get attributes() {
                  return {
                    ...requestAttributes({
                      method,
                      params: message.params,
                      id,
                      direction: from,
                      contextID: params.contextID,
                      capture,
                      protocolVersion,
                      network: { transport: 'pipe' },
                      deferOperationName: true,
                    }),
                    ...(remoteContext === undefined ? {} : { 'mokei.mcp.proxied': true }),
                  }
                },
              },
              fromMeta ? remote : parent,
            ),
          })
        } else if (message.id == null) {
          context.with(parent, () => {
            const captured =
              message.params === undefined || !contextSpan.isRecording()
                ? undefined
                : capturePayload(message.params, capture)
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
        const entry = open.get(key)
        if (entry === undefined) return
        const { span, method } = entry
        const side = from === 'client' ? 'server' : 'client'
        const rpcError =
          isRecord(message.error) && typeof message.error.code === 'number'
            ? {
                code: message.error.code,
                message:
                  typeof message.error.message === 'string' ? message.error.message : undefined,
              }
            : undefined
        if (
          method === 'initialize' &&
          isRecord(message.result) &&
          typeof message.result.protocolVersion === 'string'
        ) {
          protocolVersion = message.result.protocolVersion
          contextSpan.setAttribute('mcp.protocol.version', protocolVersion)
        }
        if (span.isRecording()) {
          const result = 'result' in message ? message.result : undefined
          if (rpcError === undefined)
            span.setAttributes(responseAttributes(method, result, capture))
          const captured = capturePayload(
            'result' in message ? message.result : message.error,
            capture,
          )
          span.addEvent(
            'mcp.response',
            captured === undefined
              ? {}
              : {
                  'mokei.mcp.response': captured.payload,
                  ...(captured.truncated ? { 'mokei.payload.truncated': true } : {}),
                },
          )
        }
        const outcome = responseOutcome({ result: message.result, error: rpcError }, side)
        if (outcome.error) finish(key, outcome.errorType, outcome.message, outcome.statusCode)
        else
          finish(
            key,
            undefined,
            undefined,
            outcome.statusCode,
            isInputRequiredResult(message.result),
          )
      }
    },
    end(reason) {
      if (ended) return
      ended = true
      for (const key of open.keys()) finish(key, `context.${reason}`)
      if (mcpMetricsEnabled())
        recordMCPSession({
          durationS: (performance.now() - startedAt) / 1000,
          attributes: metricAttributes({
            'network.transport': 'pipe',
            'mcp.protocol.version': protocolVersion,
            ...(reason === 'lost' ? { 'error.type': 'context.lost' } : {}),
          }),
        })
      if (reason === 'lost') endSpanError(contextSpan, 'context.lost')
      else contextSpan.end()
    },
  }
}
