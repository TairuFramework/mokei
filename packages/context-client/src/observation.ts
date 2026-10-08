import type { Attributes } from '@opentelemetry/api'

export type PayloadCapture = 'on' | 'off' | number
export type MessageDirection = 'client' | 'server'

export const DEFAULT_PAYLOAD_CAP = 65536

const META_KEYS = new Set(['traceparent', 'dev.mokei/flow-run'])
const SECRET_KEY = /(?:secret|token|password|authorization|api[-_]?key)/i

export function resolvePayloadCap(capture: PayloadCapture | undefined): number | null {
  if (capture === 'off') return null
  if (typeof capture === 'number') return Math.max(0, capture)
  return DEFAULT_PAYLOAD_CAP
}

export function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (key === '_meta') {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [[key, {}]]
        const allowed = Object.fromEntries(
          Object.entries(entry).filter(([metaKey]) => META_KEYS.has(metaKey)),
        )
        return [[key, redactPayload(allowed)]]
      }
      return [[key, SECRET_KEY.test(key) ? '[redacted]' : redactPayload(entry)]]
    }),
  )
}

export function capturePayload(
  value: unknown,
  capture: PayloadCapture | undefined,
): { payload: string; truncated: boolean } | undefined {
  const cap = resolvePayloadCap(capture)
  if (cap === null) return undefined

  const serialised = JSON.stringify(redactPayload(value))
  if (serialised === undefined) return { payload: 'null', truncated: false }
  const encoder = new TextEncoder()
  if (encoder.encode(serialised).length <= cap) return { payload: serialised, truncated: false }

  let payload = ''
  let bytes = 0
  for (const character of serialised) {
    const characterBytes = encoder.encode(character).length
    if (bytes + characterBytes > cap) break
    payload += character
    bytes += characterBytes
  }
  return { payload, truncated: true }
}

export function requestSpanName(method: string): string {
  return `mcp.${method}`
}

export function requestAttributes(params: {
  method: string
  params?: unknown
  id?: string | number
  direction: MessageDirection
  contextID?: string
  sessionID?: string
  capture?: PayloadCapture
}): Attributes {
  const attributes: Attributes = {
    'mokei.kind': 'mcp',
    'mcp.method.name': params.method,
    'mokei.direction': params.direction,
  }
  if (
    params.method === 'tools/call' &&
    isRecord(params.params) &&
    typeof params.params.name === 'string'
  ) {
    attributes['gen_ai.tool.name'] = params.params.name
  }
  if (params.id !== undefined) attributes['jsonrpc.request.id'] = String(params.id)
  if (params.contextID !== undefined) attributes['mokei.context.id'] = params.contextID
  if (params.sessionID !== undefined) attributes['mcp.session.id'] = params.sessionID
  if (params.params !== undefined) {
    const captured = capturePayload(params.params, params.capture)
    if (captured !== undefined) {
      attributes['mokei.mcp.request'] = captured.payload
      if (captured.truncated) attributes['mokei.payload.truncated'] = true
    }
  }
  return attributes
}

export function responseOutcome(message: {
  result?: unknown
  error?: { code: number }
}): { error: false } | { error: true; errorType: string } {
  if (message.error !== undefined) return { error: true, errorType: String(message.error.code) }
  if (isRecord(message.result) && message.result.isError === true) {
    return { error: true, errorType: 'tool_error' }
  }
  return { error: false }
}

export function sanitizeMessage(message: unknown, capture: PayloadCapture | undefined): unknown {
  if (!isRecord(message)) return redactPayload(message)
  const cap = resolvePayloadCap(capture)
  if (cap === null) {
    return Object.fromEntries(
      Object.entries(message).filter(([key]) => ['jsonrpc', 'id', 'method'].includes(key)),
    )
  }

  const sanitised = redactPayload(message) as Record<string, unknown>
  let truncated = false
  for (const key of ['params', 'result']) {
    if (!(key in sanitised)) continue
    const captured = capturePayload(sanitised[key], capture)
    if (captured?.truncated) {
      sanitised[key] = captured.payload
      truncated = true
    }
  }
  if (truncated) sanitised['dev.mokei/truncated'] = true
  return sanitised
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
