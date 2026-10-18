import type { Attributes } from '@opentelemetry/api'

export type PayloadCapture = 'on' | 'off' | number
export type MessageDirection = 'client' | 'server'

export const DEFAULT_PAYLOAD_CAP = 65536

const META_KEYS = new Set(['traceparent', 'dev.mokei/flow-run'])
const PUBLIC_KEYS = new Set([
  'maxTokens',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'progressToken',
])
const SECRET_KEY = /authorization|token|secret|password|api[-_]?key|cookie|credential/i

export function resolvePayloadCap(capture: PayloadCapture | undefined): number | null {
  if (capture === undefined || capture === 'off') return null
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
      return [
        [key, !PUBLIC_KEYS.has(key) && SECRET_KEY.test(key) ? '[redacted]' : redactPayload(entry)],
      ]
    }),
  )
}

export function capturePayload(
  value: unknown,
  capture: PayloadCapture | undefined,
  options?: { redact?: boolean },
): { payload: string; truncated: boolean } | undefined {
  const cap = resolvePayloadCap(capture)
  if (cap === null) return undefined

  const serialised = JSON.stringify(options?.redact === false ? value : redactPayload(value))
  if (serialised === undefined) return { payload: 'null', truncated: false }
  return capText(serialised, cap)
}

function capText(text: string, cap: number): { payload: string; truncated: boolean } {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= cap) return { payload: text, truncated: false }

  let payload = ''
  let bytes = 0
  for (const character of text) {
    const characterBytes = encoder.encode(character).length
    if (bytes + characterBytes > cap) break
    payload += character
    bytes += characterBytes
  }
  return { payload, truncated: true }
}

export type NetworkInfo = {
  transport: 'pipe' | 'tcp'
  protocolName?: 'http'
  serverAddress?: string
  serverPort?: number
}

/** JSON-RPC protocol-level codes a server returns for bad requests; not server faults. */
export const SERVER_NON_ERROR_CODES = new Set([-32700, -32600, -32601, -32602, -32002])

const RESOURCE_URI_METHODS = new Set([
  'resources/read',
  'resources/subscribe',
  'resources/unsubscribe',
  'notifications/resources/updated',
])

export function requestSpanName(method: string, params?: unknown): string {
  if (
    (method === 'tools/call' || method === 'prompts/get') &&
    isRecord(params) &&
    typeof params.name === 'string'
  ) {
    return `${method} ${params.name}`
  }
  return method
}

export function requestAttributes(params: {
  method: string
  params?: unknown
  id?: string | number
  direction: MessageDirection
  contextID?: string
  sessionID?: string
  capture?: PayloadCapture
  protocolVersion?: string
  network?: NetworkInfo
  traceAttributes?: Attributes
  /** Leave `gen_ai.operation.name` to `settleAttributes`: a suspended round is not a tool execution. */
  deferOperationName?: boolean
}): Attributes {
  const attributes: Attributes = {
    'mokei.kind': 'mcp',
    'mcp.method.name': params.method,
    'mokei.direction': params.direction,
  }
  const body = isRecord(params.params) ? params.params : undefined
  if (params.method === 'tools/call') {
    if (params.deferOperationName !== true) attributes['gen_ai.operation.name'] = 'execute_tool'
    if (typeof body?.name === 'string') attributes['gen_ai.tool.name'] = body.name
    if (body?.arguments !== undefined) {
      const captured = capturePayload(body.arguments, params.capture)
      if (captured !== undefined) {
        attributes['gen_ai.tool.call.arguments'] = captured.payload
        if (captured.truncated) attributes['mokei.payload.truncated'] = true
      }
    }
  } else if (params.method === 'prompts/get') {
    if (typeof body?.name === 'string') attributes['gen_ai.prompt.name'] = body.name
    if (isRecord(body?.arguments)) {
      for (const [key, value] of Object.entries(body.arguments)) {
        const redacted =
          !PUBLIC_KEYS.has(key) && SECRET_KEY.test(key) ? '[redacted]' : redactPayload(value)
        const cap = resolvePayloadCap(params.capture)
        if (cap === null) continue
        const captured =
          typeof redacted === 'string'
            ? capText(redacted, cap)
            : (capturePayload(redacted, params.capture) as { payload: string; truncated: boolean })
        attributes[`gen_ai.prompt.variable.${key}`] = captured.payload
        if (captured.truncated) attributes['mokei.payload.truncated'] = true
      }
    }
  } else if (RESOURCE_URI_METHODS.has(params.method) && typeof body?.uri === 'string') {
    attributes['mcp.resource.uri'] = body.uri
  }
  if (params.protocolVersion !== undefined)
    attributes['mcp.protocol.version'] = params.protocolVersion
  if (params.network !== undefined) {
    attributes['network.transport'] = params.network.transport
    if (params.network.protocolName !== undefined) {
      attributes['network.protocol.name'] = params.network.protocolName
    }
    if (params.network.serverAddress !== undefined) {
      attributes['server.address'] = params.network.serverAddress
    }
    if (params.network.serverPort !== undefined)
      attributes['server.port'] = params.network.serverPort
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
  return { ...attributes, ...params.traceAttributes }
}

/**
 * Attributes set when an exchange settles: only a `tools/call` that does not suspend is an
 * `execute_tool`, and MRTR rounds carry their 0-based index.
 */
export function settleAttributes(params: {
  method: string
  inputRequired: boolean
  round?: number
}): Attributes {
  const attributes: Attributes = {}
  if (params.method === 'tools/call' && !params.inputRequired) {
    attributes['gen_ai.operation.name'] = 'execute_tool'
  }
  if (params.round !== undefined) attributes['mokei.mcp.round'] = params.round
  return attributes
}

export function responseAttributes(
  method: string,
  result: unknown,
  capture: PayloadCapture | undefined,
): Attributes {
  if (method !== 'tools/call' || (isRecord(result) && result.isError === true)) return {}
  const captured = capturePayload(result, capture)
  if (captured === undefined) return {}
  return {
    'gen_ai.tool.call.result': captured.payload,
    ...(captured.truncated ? { 'mokei.payload.truncated': true } : {}),
  }
}

export function responseOutcome(
  message: { result?: unknown; error?: { code: number; message?: string } },
  side: MessageDirection,
):
  | { error: false; statusCode?: string }
  | { error: true; errorType: string; statusCode?: string; message?: string } {
  if (message.error !== undefined) {
    const statusCode = String(message.error.code)
    if (side === 'server' && SERVER_NON_ERROR_CODES.has(message.error.code)) {
      return { error: false, statusCode }
    }
    return { error: true, errorType: statusCode, statusCode, message: message.error.message }
  }
  if (isRecord(message.result) && message.result.isError === true) {
    return { error: true, errorType: 'tool_error' }
  }
  return { error: false }
}

export function sanitizeMessage(message: unknown, capture: PayloadCapture | undefined): unknown {
  if (!isRecord(message)) return redactPayload(message)
  const cap = resolvePayloadCap(capture)
  if (cap === null) {
    const sanitised = Object.fromEntries(
      Object.entries(message).filter(([key]) => ['jsonrpc', 'id', 'method'].includes(key)),
    )
    if (isRecord(message.error)) {
      sanitised.error = { code: message.error.code, message: message.error.message }
    }
    return sanitised
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
  if (isRecord(sanitised.error) && 'data' in sanitised.error) {
    const captured = capturePayload(sanitised.error.data, capture)
    if (captured?.truncated) {
      sanitised.error.data = captured.payload
      truncated = true
    }
  }
  if (truncated) sanitised['dev.mokei/truncated'] = true
  return sanitised
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function redactCommandArgs(args: Array<string>): Array<string> {
  let redactNext = false
  return args.map((argument) => {
    if (redactNext) {
      redactNext = false
      return '[redacted]'
    }
    if (!argument.startsWith('-') || argument === '--') return argument
    const separator = argument.indexOf('=')
    const flag = separator === -1 ? argument : argument.slice(0, separator)
    if (!SECRET_KEY.test(flag.replace(/^-+/, ''))) return argument
    if (separator !== -1) return `${flag}=[redacted]`
    redactNext = true
    return argument
  })
}
