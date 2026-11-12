import {
  type ContextClient,
  endSpanError,
  getMokeiTracer,
  mcpMetricsEnabled,
  metricAttributes,
  type NetworkInfo,
  type PayloadCapture,
  recordMCPSession,
  type TerminationReason,
  type TraceParentFrom,
} from '@mokei/context-client'
import type { InitializeResult } from '@mokei/context-protocol'
import type { HTTPTransport } from '@mokei/http-client'
import { ROOT_CONTEXT, type SpanContext } from '@opentelemetry/api'

import type { ContextTransport } from './types.js'

/** The protocol revision is unresolved (and the getter throws) while an `'auto'` probe is pending. */
export function currentProtocolVersion(client: ContextClient): string | undefined {
  try {
    return client.protocolVersion
  } catch {
    return undefined
  }
}

export function networkInfo(transport: ContextTransport, url?: string): NetworkInfo | undefined {
  if (transport === 'stdio') return { transport: 'pipe' }
  if (transport !== 'http') return undefined
  const info: NetworkInfo = { transport: 'tcp', protocolName: 'http' }
  if (url === undefined) return info
  try {
    const parsed = new URL(url)
    info.serverAddress = parsed.hostname.replace(/^\[|\]$/g, '')
    info.serverPort =
      parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
  } catch {
    // Unparseable URL: keep transport-level attributes only.
  }
  return info
}

export type StartContextSpanParams = {
  key: string
  client: ContextClient
  transport: ContextTransport
  httpTransport?: HTTPTransport
  url?: string
  payloads?: PayloadCapture
  parentFrom?: TraceParentFrom
  /** Set when the client replaces a lost one: links to its span and records the attempt. */
  reconnect?: { link?: SpanContext; attempt: number }
}

export type ContextSpan = {
  spanContext: SpanContext
  /** Ends the span and records the session metric; only the first call acts. */
  settle: (reason: TerminationReason) => void
  /** Listener for the client's `initialized` event; a no-op once settled. */
  onInitialized: (result: InitializeResult) => void
}

/**
 * Starts a client's `mcp.context` span and sets the client's tracing on it. The span is a trace
 * root, ended by `settle` with the session metric.
 */
export function startContextSpan(params: StartContextSpanParams): ContextSpan {
  const { key, client, transport, httpTransport, url, reconnect } = params
  const network = networkInfo(transport, url)
  const span = getMokeiTracer('host').startSpan(
    'mcp.context',
    {
      ...(reconnect?.link == null ? {} : { links: [{ context: reconnect.link }] }),
      attributes: {
        ...(reconnect == null ? {} : { 'mokei.context.reconnect.attempt': reconnect.attempt }),
        'mokei.kind': 'context',
        'mokei.root': true,
        'mokei.context.id': key,
        'mokei.context.transport': transport,
        ...(network === undefined
          ? {}
          : {
              'network.transport': network.transport,
              ...(network.protocolName === undefined
                ? {}
                : { 'network.protocol.name': network.protocolName }),
              ...(network.serverAddress === undefined
                ? {}
                : { 'server.address': network.serverAddress }),
              ...(network.serverPort === undefined ? {} : { 'server.port': network.serverPort }),
            }),
      },
    },
    ROOT_CONTEXT,
  )
  client.setTracing({
    contextID: key,
    contextSpan: span,
    payloads: params.payloads,
    ...(params.parentFrom === undefined ? {} : { parentFrom: params.parentFrom }),
    getSessionID: () => httpTransport?.sessionID ?? undefined,
    getProtocolVersion: () => currentProtocolVersion(client),
    network,
  })
  const initialVersion = currentProtocolVersion(client)
  if (initialVersion !== undefined) span.setAttribute('mcp.protocol.version', initialVersion)
  if (client.initializationResult != null)
    span.setAttribute('mokei.server.name', client.initializationResult.serverInfo.name)
  let settled = false
  const startedAt = performance.now()
  const settle = (reason: TerminationReason): void => {
    if (settled) return
    settled = true
    client.endTracing(reason)
    if (mcpMetricsEnabled())
      recordMCPSession({
        durationS: (performance.now() - startedAt) / 1000,
        attributes: metricAttributes({
          ...(network === undefined
            ? {}
            : {
                'network.transport': network.transport,
                'network.protocol.name': network.protocolName,
                'server.address': network.serverAddress,
                'server.port': network.serverPort,
              }),
          'mcp.protocol.version': currentProtocolVersion(client),
          ...(reason === 'lost' ? { 'error.type': 'context.lost' } : {}),
        }),
      })
    if (httpTransport?.sessionID != null)
      span.setAttribute('mcp.session.id', httpTransport.sessionID)
    if (reason === 'lost') endSpanError(span, 'context.lost')
    else span.end()
  }
  const onInitialized = ({ serverInfo }: InitializeResult): void => {
    if (settled) return
    span.setAttribute('mokei.server.name', serverInfo.name)
    const version = currentProtocolVersion(client)
    if (version !== undefined) span.setAttribute('mcp.protocol.version', version)
    if (httpTransport?.sessionID != null)
      span.setAttribute('mcp.session.id', httpTransport.sessionID)
  }
  return { spanContext: span.spanContext(), settle, onInitialized }
}
