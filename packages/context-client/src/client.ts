import type {
  CallToolRequest,
  CallToolResult,
  ClientCapabilities,
  ClientMessage,
  ClientNotifications,
  ClientRequests,
  ClientResult,
  CompleteRequest,
  CompleteResult,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  GetPromptResult,
  InitializeRequest,
  InitializeResult,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListToolsRequest,
  ListToolsResult,
  Log,
  Metadata,
  ProgressNotification,
  ReadResourceRequest,
  ReadResourceResult,
  Result,
  Root,
  ServerMessage,
  ServerNotification,
  ServerRequest,
  SetLevelRequest,
} from '@mokei/context-protocol'
import {
  type ErrorResponse,
  isSupportedProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  SUPPORTED_PROTOCOL_VERSIONS,
  serverMessage,
} from '@mokei/context-protocol'
import { ContextRPC, RequestTimeoutError, RPCError, type SentRequest } from '@mokei/context-rpc'
import { lazy } from '@sozai/async'
import { createValidator } from '@sozai/schema'

import { currentTraceMeta } from './trace.js'
import type { ClientTransport } from './types.js'

const validateServerMessage = createValidator(serverMessage)

export const DEFAULT_INITIALIZE_PARAMS: InitializeRequest['params'] = {
  capabilities: {},
  clientInfo: {
    name: 'Mokei',
    version: '0.4.0',
  },
  protocolVersion: LATEST_PROTOCOL_VERSION,
}

export const DEFAULT_INITIALIZE_TIMEOUT = 30_000

/** Max notifications buffered once a reader is attached; oldest dropped past this. */
const NOTIFICATION_BUFFER_CAP = 256

export class UnsupportedProtocolVersionError extends Error {
  constructor(received: string) {
    super(
      `Server responded with unsupported protocolVersion "${received}"; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
    )
    this.name = 'UnsupportedProtocolVersionError'
  }
}

export class CapabilityNotDeclaredError extends Error {
  constructor(capability: string) {
    super(`Server did not declare the "${capability}" capability`)
    this.name = 'CapabilityNotDeclaredError'
  }
}

export type ElicitHandler = (
  params: ElicitRequest['params'],
  signal: AbortSignal,
) => ElicitResult | Promise<ElicitResult>

export type CreateMessageHandler = (
  params: CreateMessageRequest['params'],
  signal: AbortSignal,
) => CreateMessageResult | Promise<CreateMessageResult>

export type ListRootsHandler = (signal: AbortSignal) => Array<Root> | Promise<Array<Root>>

export type ClientEvents = {
  closed: { error?: Error }
  initialized: InitializeResult
  log: Log
}

type HandleNotification = ProgressNotification | ServerNotification

type ClientTypes = {
  Events: ClientEvents
  MessageIn: ServerMessage
  MessageOut: ClientMessage
  HandleNotification: HandleNotification
  HandleRequest: ServerRequest
  SendNotifications: ClientNotifications
  SendRequests: ClientRequests
  SendResult: ClientResult
}

export type ContextTypes = {
  Prompts?: Record<string, Record<string, unknown> | never>
  Tools?: Record<string, Record<string, unknown>>
}

export type UnknownContextTypes = {
  Prompts: Record<string, Record<string, unknown>>
  Tools: Record<string, Record<string, unknown>>
}

export type PromptParams<T extends ContextTypes> = {
  name: keyof T['Prompts'] & string
  arguments: T['Prompts'][keyof T['Prompts']] extends undefined
    ? never
    : T['Prompts'][keyof T['Prompts']]
  _meta?: Metadata
}

export type ToolParams<T extends ContextTypes> = {
  name: keyof T['Tools'] & string
  arguments: T['Tools'][keyof T['Tools']] extends undefined ? never : T['Tools'][keyof T['Tools']]
  _meta?: Metadata
}

export type ClientParams = {
  createMessage?: CreateMessageHandler
  elicit?: ElicitHandler
  initializeTimeout?: number
  listRoots?: Array<Root> | ListRootsHandler
  transport: ClientTransport
}

export class ContextClient<
  T extends ContextTypes = UnknownContextTypes,
> extends ContextRPC<ClientTypes> {
  #createMessage?: CreateMessageHandler
  #elicit?: ElicitHandler
  #initialized: PromiseLike<InitializeResult>
  #initializeTimeout: number
  #listRoots?: Array<Root> | ListRootsHandler
  #notificationBuffer: Array<HandleNotification> = []
  #notificationPull: (() => void) | null = null
  #hasNotificationReader = false
  #notifications: ReadableStream<HandleNotification>
  #serverCapabilities: InitializeResult['capabilities'] = {}

  constructor(params: ClientParams) {
    super({ validateMessageIn: validateServerMessage, transport: params.transport })
    this.#createMessage = params.createMessage
    this.#elicit = params.elicit
    this.#initialized = lazy(() => this.#initialize())
    this.#initializeTimeout = params.initializeTimeout ?? DEFAULT_INITIALIZE_TIMEOUT
    this.#listRoots = params.listRoots
    this.#notifications = new ReadableStream<HandleNotification>(
      {
        pull: (controller) => {
          const next = this.#notificationBuffer.shift()
          if (next != null) {
            controller.enqueue(next)
            return
          }
          // No buffered item: park until the next notification arrives.
          return new Promise<void>((resolve) => {
            this.#notificationPull = () => {
              this.#notificationPull = null
              const queued = this.#notificationBuffer.shift()
              if (queued != null) {
                controller.enqueue(queued)
              }
              resolve()
            }
          })
        },
        cancel: () => {
          this.#hasNotificationReader = false
          this.#notificationBuffer = []
          this.#notificationPull = null
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    )
  }

  // Inject W3C trace context (SEP-414) into every outgoing request's `_meta`.
  // No-op when no OpenTelemetry SDK is active.
  request<Method extends keyof ClientTypes['SendRequests']>(
    method: Method,
    params: ClientTypes['SendRequests'][Method]['Params'],
    options?: { timeout?: number },
  ): SentRequest<ClientTypes['SendRequests'][Method]['Result']> {
    const trace = currentTraceMeta()
    if (trace.traceparent == null) {
      return super.request(method, params, options)
    }
    const base =
      params != null && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const existingMeta =
      base._meta != null && typeof base._meta === 'object'
        ? (base._meta as Record<string, unknown>)
        : {}
    const merged = { ...base, _meta: { ...existingMeta, ...trace } }
    return super.request(method, merged as typeof params, options)
  }

  async #initialize(): Promise<InitializeResult> {
    const id = this._getNextRequestID()
    // Build capabilities
    const capabilities: ClientCapabilities = {}
    if (this.#elicit != null) {
      capabilities.elicitation = {}
    }
    if (this.#createMessage != null) {
      capabilities.sampling = {}
    }
    if (this.#listRoots != null) {
      capabilities.roots = {}
    }
    // Send initialize request
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { ...DEFAULT_INITIALIZE_PARAMS, capabilities },
    })
    // Wait for the matching response, bounded by the initialize timeout. The
    // deadline promise is built once (not per iteration) so reading past stray
    // pre-init messages doesn't accumulate abort listeners on the signal.
    const timeoutMs = this.#initializeTimeout
    const deadline = AbortSignal.timeout(timeoutMs)
    const timedOut = new Promise<never>((_resolve, reject) => {
      const fail = () =>
        reject(
          new RequestTimeoutError(
            `Server did not respond to initialize request within ${timeoutMs}ms`,
          ),
        )
      if (deadline.aborted) {
        fail()
      } else {
        deadline.addEventListener('abort', fail, { once: true })
      }
    })
    let result: InitializeResult | undefined
    while (result == null) {
      // The losing _read() stays pending and holds the reader lock; it resolves
      // (done) when the transport is later disposed. Its result is ignored.
      const next = await Promise.race([this._read(), timedOut])
      if (next.done) {
        throw new Error('Server closed the connection during initialize')
      }
      const message = next.value
      // Drop anything that isn't the initialize response: pre-init notifications
      // and server requests can't be handled before the session is established.
      if (message.id !== id) {
        continue
      }
      if ('error' in message) {
        throw RPCError.fromResponse(message as ErrorResponse)
      }
      result = message.result as InitializeResult
    }
    // Reject an unsupported negotiated version before establishing the session.
    if (!isSupportedProtocolVersion(result.protocolVersion)) {
      await this.dispose()
      throw new UnsupportedProtocolVersionError(result.protocolVersion)
    }
    // Store server capabilities for client-side gating (Task 13).
    this.#serverCapabilities = result.capabilities
    // Start listening for incoming messages
    this._handle()
    // Notify server that client is initialized
    await super._write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    this.events.emit('initialized', result)
    return result
  }

  _onTransportClosed(reason?: Error): void {
    this.events.emit('closed', { error: reason })
  }

  // Override _write method to ensure that client is initialized before sending messages
  async _write(message: ClientMessage): Promise<void> {
    await this.#initialized
    await super._write(message)
  }

  _handleNotification(notification: HandleNotification): void {
    if (notification.method === 'notifications/message') {
      this.events.emit('log', notification.params)
    }
    // Drop until a reader attaches, then keep only the most recent CAP.
    if (!this.#hasNotificationReader) {
      return
    }
    this.#notificationBuffer.push(notification)
    if (this.#notificationBuffer.length > NOTIFICATION_BUFFER_CAP) {
      this.#notificationBuffer.shift()
    }
    this.#notificationPull?.()
  }

  async _handleRequest(request: ServerRequest, signal: AbortSignal): Promise<ClientResult> {
    switch (request.method) {
      case 'elicitation/create': {
        if (this.#elicit != null) {
          return await this.#elicit(request.params, signal)
        }
        break
      }
      case 'roots/list': {
        if (this.#listRoots == null) {
          throw new RPCError(METHOD_NOT_FOUND, 'roots capability not supported')
        }
        const roots = Array.isArray(this.#listRoots)
          ? this.#listRoots
          : await this.#listRoots(signal)
        return { roots }
      }
      case 'sampling/createMessage':
        if (this.#createMessage != null) {
          return await this.#createMessage(request.params, signal)
        }
    }
    throw new RPCError(METHOD_NOT_FOUND, 'Method not implemented')
  }

  // Guard: throws synchronously when the server did not declare the given capability.
  // Only meaningful after initialize() completes; #serverCapabilities is {} until then.
  #requireServerCapability(capability: 'tools' | 'logging' | 'completions'): void {
    if (this.#serverCapabilities[capability] == null) {
      throw new CapabilityNotDeclaredError(capability)
    }
  }

  get notifications(): ReadableStream<ServerNotification> {
    this.#hasNotificationReader = true
    return this.#notifications as ReadableStream<ServerNotification>
  }

  async initialize(): Promise<InitializeResult> {
    return await this.#initialized
  }

  async setLoggingLevel(params: SetLevelRequest['params']): Promise<Result> {
    await this.#initialized
    this.#requireServerCapability('logging')
    return await this.request('logging/setLevel', params)
  }

  async complete(params: CompleteRequest['params']): Promise<CompleteResult> {
    await this.#initialized
    this.#requireServerCapability('completions')
    return await this.request('completion/complete', params)
  }

  listPrompts(params: ListPromptsRequest['params'] = {}): SentRequest<ListPromptsResult> {
    return this.request('prompts/list', params)
  }

  getPrompt(params: PromptParams<T>): SentRequest<GetPromptResult> {
    return this.request('prompts/get', params as GetPromptRequest['params'])
  }

  listResources(params: ListResourcesRequest['params'] = {}): SentRequest<ListResourcesResult> {
    return this.request('resources/list', params)
  }

  listResourceTemplates(
    params: ListResourceTemplatesRequest['params'] = {},
  ): SentRequest<ListResourceTemplatesResult> {
    return this.request('resources/templates/list', params)
  }

  readResource(params: ReadResourceRequest['params']): SentRequest<ReadResourceResult> {
    return this.request('resources/read', params)
  }

  async listTools(params: ListToolsRequest['params'] = {}): Promise<ListToolsResult> {
    await this.#initialized
    this.#requireServerCapability('tools')
    return await this.request('tools/list', params)
  }

  callTool(params: ToolParams<T>): SentRequest<CallToolResult> {
    return this.request('tools/call', params as CallToolRequest['params'])
  }
}
