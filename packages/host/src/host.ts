import { DirectTransports } from '@enkaku/transport'
import {
  type ClientTransport,
  ContextClient,
  type ContextTypes,
  capturePayload,
  type ElicitHandler,
  endSpanError,
  errorTypeOf,
  getMokeiTracer,
  type ListParams,
  mcpMetricsEnabled,
  metricAttributes,
  type NetworkInfo,
  type PayloadCapture,
  type PromptParams,
  recordMCPSession,
  resolveContentCapture,
  TaskInterruptedError,
  type TerminationReason,
  type ToolParams,
  type TraceParentFrom,
  transportFailureOf,
  type UnknownContextTypes,
} from '@mokei/context-client'
import type {
  CallToolResult,
  ClientMessage,
  ElicitRequest,
  ElicitResult,
  GetPromptResult,
  Metadata,
  ProtocolVersion,
  ServerMessage,
  Tool,
} from '@mokei/context-protocol'
import { TransportClosedError, type WithRequestOptions } from '@mokei/context-rpc'
import { ContextServer, type JSONValue, type ServerConfig } from '@mokei/context-server'
import {
  type ConnectionEvent,
  type FetchMiddleware,
  type HTTPAuthOptions,
  HTTPTransport,
  type Runtime,
  SessionExpiredError,
} from '@mokei/http-client'
import { ROOT_CONTEXT, type SpanContext, SpanKind } from '@opentelemetry/api'
import { Disposer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'

import { ContextUnavailableError } from './errors.js'
import {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  type LocalTool,
  type LocalToolDefinition,
} from './local-tools.js'
import {
  type ContextConnectivity,
  type ContextFactory,
  ReconnectController,
  type ReconnectEvents,
  type ReconnectOptions,
  resolveReconnectOptions,
} from './reconnect.js'

type ContextTransport = 'stdio' | 'http' | 'direct'

/** The protocol revision is unresolved (and the getter throws) while an `'auto'` probe is pending. */
function currentProtocolVersion(client: ContextClient): string | undefined {
  try {
    return client.protocolVersion
  } catch {
    return undefined
  }
}

function networkInfo(transport: ContextTransport, url?: string): NetworkInfo | undefined {
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

export type EnableTools = boolean | Array<string>
export type EnableToolsFn = (tools: Array<Tool>) => EnableTools | Promise<EnableTools>
export type EnableToolsArg = EnableTools | EnableToolsFn

export function getContextToolID(contextKey: string, toolName: string): string {
  return `${contextKey}:${toolName}`
}

export function getContextToolInfo(id: string): [string, string] {
  const index = id.indexOf(':')
  if (index === -1) {
    throw new Error(`Invalid context tool ID: ${id}`)
  }
  return [id.slice(0, index), id.slice(index + 1)]
}

/**
 * Parameters for setting up a context: which tools to enable, plus the options for the
 * `tools/list` request the setup issues.
 */
export type SetupParams = ListParams<{
  key: string
  /** Which of the context's tools to enable. Defaults to all of them. */
  enableTools?: EnableToolsArg
}>

/** Parameters for replacing a context's tools wholesale. */
export type SetContextToolsParams = {
  key: string
  tools: Array<ContextTool>
}

/** Parameters for the tool-enablement methods, which act on a context's tools by name. */
export type ContextToolNamesParams = {
  key: string
  toolNames: Array<string>
}

/**
 * A per-call elicitation handler. On `2026-07-28` it answers the call's `elicitation/create` input
 * requests (MRTR, SEP-2322) ahead of any {@link ContextHost.handleElicitation} override; `fallback`
 * hands the request to the host-wide path. It never enables elicitation for a context added with
 * `elicit: false` or a host without elicitation. On `2025-11-25` it is ignored: a server-initiated
 * `elicitation/create` has no link to its call, so the host-wide path answers.
 */
export type PerCallElicit = { elicit?: HostElicitOverride }

/** Parameters for getting a prompt from a context, keyed by context. */
export type ContextPromptParams<T extends ContextTypes = UnknownContextTypes> = WithRequestOptions<
  PromptParams<T>
> &
  PerCallElicit & { key: string }

/** Parameters for calling a tool on a context, keyed by context. */
export type ContextToolParams<T extends ContextTypes = UnknownContextTypes> = WithRequestOptions<
  ToolParams<T>
> &
  PerCallElicit & { key: string }

/** Parameters for calling a tool by its namespaced ID (`contextKey:toolName` or `local:toolName`). */
export type NamespacedToolParams = WithRequestOptions<{
  id: string
  arguments?: Record<string, unknown>
  _meta?: Metadata
}> &
  PerCallElicit

/** Parameters for calling a local tool. Local tools run in-process, so they take no `timeout`. */
export type LocalToolParams = {
  name: string
  arguments?: Record<string, unknown>
  _meta?: Record<string, JSONValue>
  signal?: AbortSignal
  /** Attributes added to the `execute_tool` span; never sent anywhere else. */
  traceAttributes?: Record<string, string>
}

export type AllowToolCalls = 'always' | 'ask' | 'never'

export type ContextTool = {
  id: string
  tool: Tool
  enabled: boolean
  allow?: AllowToolCalls
}

export type HostedContext<T extends ContextTypes = UnknownContextTypes> = {
  client: ContextClient<T>
  disposer: Disposer
  tools: Array<ContextTool>
}

export type CreateHostedContextParams = {
  transport: ClientTransport
  tools?: Array<ContextTool>
  elicit?: ElicitHandler
  dispose?: () => void | Promise<void>
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export type CreateContextParams = Omit<CreateHostedContextParams, 'elicit'> & {
  key: string
  elicit?: false
}

export type HostElicitRequest = {
  key: string
  params: ElicitRequest['params']
  signal: AbortSignal
}

export type HostElicitHandler = (request: HostElicitRequest) => ElicitResult | Promise<ElicitResult>

export type ElicitFallback = (options?: { signal?: AbortSignal }) => Promise<ElicitResult>

export type HostElicitOverride = (
  request: HostElicitRequest,
  fallback: ElicitFallback,
) => ElicitResult | Promise<ElicitResult>

export type ContextHostParams = {
  /** Subclass teardown, run after every context is removed. */
  dispose?: () => Promise<void>
  elicit?: HostElicitHandler | true
  /** MCP payload capture defaults to 'off'. */
  tracing?: { payloads?: PayloadCapture; parentFrom?: TraceParentFrom }
  /**
   * Reports whether the network is reachable. A reconnect waits while offline without spending
   * attempts; a missing or throwing hook counts as online.
   */
  connectivity?: ContextConnectivity
}

export type HasContextParams = { key: string }

/** Parameters of {@link ContextHost.subscribeResource} and `unsubscribeResource`. */
export type ContextResourceSubscriptionParams = {
  key: string
  uri: string
  /** Aborts the change before the server acknowledges it. */
  signal?: AbortSignal
}

export type RegisterHostedContextParams = {
  key: string
  context: HostedContext
  transport?: ContextTransport
  /** Rebuilds the context after a loss once `setup()` has run. Omit to remove it on loss. */
  reconnect?: { options: ReconnectOptions; factory: ContextFactory }
}

export type HostEvents = {
  'context:added': { key: string }
  'context:removed': { key: string }
  'context:failed': { key: string; error: Error }
  /** A reconnect attempt for a lost context is about to start. `error` is why the last one ended. */
  'context:reconnecting': ReconnectEvents['context:reconnecting']
  /** A lost context was rebuilt; `getContext(key).client` is the new client. */
  'context:reconnected': ReconnectEvents['context:reconnected']
  /** A resource subscription could not be restored after a reconnect and was dropped. */
  'resource:subscription-lost': { key: string; uri: string; error: Error }
  /**
   * A `2026-07-28` context's server signalled its tools list changed (SEP-1391). The host has
   * already re-listed the context and refreshed its namespaced tool aggregate before emitting.
   */
  'tools:changed': { key: string }
  /**
   * A `2026-07-28` context's server signalled its prompts list changed (SEP-1391). The host has
   * already re-listed the context's prompts before emitting.
   */
  'prompts:changed': { key: string }
  /**
   * A `2026-07-28` context's server signalled its resources list changed (SEP-1391). The host has
   * already re-listed the context's resources before emitting.
   */
  'resources:changed': { key: string }
  /**
   * A `2026-07-28` context's server signalled a subscribed resource's content changed (SEP-1391),
   * carrying the resource URI. The host forwards it as-is and does not re-read the resource --
   * reacting is the consumer's policy.
   */
  'resource:updated': { key: string; uri: string }
  /**
   * A `2025-11-25` context's server completed a URL-mode elicitation
   * (`notifications/elicitation/complete`). An application can close the matching URL prompt.
   */
  'elicitation:complete': { key: string; elicitationId: string }
}

/**
 * Merges a fresh tool list into a context's tools: each surviving tool keeps its
 * `enabled`/`allow` state by name, new tools are enabled, vanished tools are dropped.
 */
function mergeContextTools(
  key: string,
  previous: Array<ContextTool>,
  tools: Array<Tool>,
): Array<ContextTool> {
  const byName = new Map(previous.map((ct) => [ct.tool.name, ct]))
  return tools.map((tool: Tool) => {
    const prior = byName.get(tool.name)
    const contextTool: ContextTool = {
      id: getContextToolID(key, tool.name),
      tool,
      enabled: prior?.enabled ?? true,
    }
    if (prior?.allow != null) {
      contextTool.allow = prior.allow
    }
    return contextTool
  })
}

function sameToolDefinitions(a: Array<ContextTool>, b: Array<ContextTool>): boolean {
  return JSON.stringify(a.map((ct) => ct.tool)) === JSON.stringify(b.map((ct) => ct.tool))
}

/**
 * A registration's resource subscriptions made through the host: the URIs the consumer wants,
 * and the one queue that serialises subscribe, unsubscribe and restoration.
 */
type ResourceSubscriptions = {
  desired: Set<string>
  /** Settles when the last queued change has; never rejects. */
  tail: Promise<void>
}

/** Host-side state of one registration (one `add*Context` call), kept across reconnects. */
type RegistrationState = {
  transport: ContextTransport
  subscriptions: ResourceSubscriptions
  url?: string
  /** The current client's HTTP transport, set non-interactive when its generation is lost. */
  httpTransport?: HTTPTransport
  controller?: ReconnectController
  /** The current client's `mcp.context` span; the next client's span links to it after a loss. */
  spanContext?: SpanContext
}

type RegisterParams = {
  transport: ContextTransport
  httpTransport?: HTTPTransport
  url?: string
  reconnect?: { options: ReconnectOptions; factory: ContextFactory }
}

/** Sends one gated request on `client`, with the time left (`undefined`: no deadline). */
type GatedSend<R> = (client: ContextClient, timeout: number | undefined) => Promise<R>

/** The request failed with the loss of its connection, not with anything the server said. */
function isLossError(error: unknown): boolean {
  if (error instanceof TransportClosedError) return true
  const kind = transportFailureOf(error)?.kind
  return kind === 'network' || kind === 'session-expired'
}

/** Whether `client`'s acknowledged listen filter carries `uri`. */
function hasResourceSubscription(client: ContextClient, uri: string): boolean {
  return client.subscriptionFilter?.resourceSubscriptions?.includes(uri) === true
}

/** The loss was the server dropping the session: there is no session left to terminate. */
function isSessionExpiry(error: unknown): boolean {
  return (
    error instanceof SessionExpiredError || transportFailureOf(error)?.kind === 'session-expired'
  )
}

/** The error a transport connection event reports to the host. */
function connectionLossError(event: ConnectionEvent): Error {
  return event.type === 'failed' ? event.error : new SessionExpiredError()
}

export function createHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: CreateHostedContextParams,
): HostedContext<T> {
  // `'auto'` rather than the newest revision: a host points at arbitrary third-party servers,
  // most of which serve `'2025-11-25'` only, and a `'2026-07-28'` pin rejects those with
  // `-32022` instead of negotiating down. Callers that know their server pin explicitly.
  const { transport, tools = [], dispose, protocolVersion = 'auto', elicit } = params
  const client = new ContextClient<T>({ protocolVersion, transport, elicit })
  const disposer = new Disposer({
    dispose: async () => {
      // Via the client, not the transport: `client.dispose()` runs `_beforeTransportClose` (tears
      // down the subscription driver, suppresses reconnect) then disposes the transport. Disposing
      // the transport directly would skip that and could leave a reconnect firing after teardown.
      await client.dispose()
      await dispose?.()
    },
  })
  return { client, disposer, tools }
}

export type AddDirectContextParams = {
  key: string
  config: ServerConfig
  tools?: Array<ContextTool>
  elicit?: false
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
  /**
   * Rebuild the context when its connection is lost, instead of removing it (`true` = defaults).
   * Applies once `setup()` has committed the context's tools. Clients returned by `add*Context`
   * or read from `getContext(key).client` earlier are not gated and go stale after a reconnect;
   * `getContext(key).client` always returns the current one.
   */
  reconnect?: boolean | ReconnectOptions
}

export type HTTPContextParams = {
  /** Unique identifier for this context */
  key: string
  elicit?: false
  /** URL of the MCP HTTP endpoint */
  url: string
  /** Optional custom headers to include in requests */
  headers?: Record<string, string>
  /** Optional authentication configuration */
  auth?: HTTPAuthOptions
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
  /** Fetch middleware (e.g. OAuth from createOAuthMiddleware) applied to the transport. */
  fetchMiddleware?: FetchMiddleware
  /**
   * Fetch and random-value implementations for the HTTP transport (default `createRuntime()`
   * from `@sozai/runtime`). React Native passes `@sozai/runtime-expo`'s `createRuntime({ fetch })`.
   */
  runtime?: Runtime
  /**
   * Rebuild the context when its connection is lost, instead of removing it (`true` = defaults):
   * a network failure, an expired session, or a GET stream that fails twice in a row. Each
   * attempt uses a new transport from these params, and never opens a sign-in: a server that
   * wants one ends the reconnect with `context:failed` (an `AuthRequiredError`).
   * Applies once `setup()` has committed the context's tools. Clients returned by `add*Context`
   * or read from `getContext(key).client` earlier are not gated and go stale after a reconnect;
   * `getContext(key).client` always returns the current one.
   */
  reconnect?: boolean | ReconnectOptions
}

export class ContextHost extends Disposer {
  #contexts: Record<string, HostedContext> = {}
  #registrations: WeakMap<HostedContext, RegistrationState> = new WeakMap()
  #connectivity?: ContextConnectivity
  #payloads?: PayloadCapture
  #parentFrom?: TraceParentFrom
  #contextSettlers = new Map<string, (reason: TerminationReason) => void>()
  #localTools: Map<string, LocalTool> = new Map()
  #events: EventEmitter<HostEvents> = new EventEmitter<HostEvents>()
  // Per-context teardown for the client subscription-event listeners wired on `2026-07-28`
  // contexts (SEP-1391). Cleared in `remove()` so a listener never outlives its context.
  #subscriptionUnsubscribes: Map<string, Array<() => void>> = new Map()
  #elicit: HostElicitHandler | true | undefined
  #elicitOverride: { handler: HostElicitOverride } | undefined

  /** Observe context lifecycle and subscription events. */
  get events(): EventEmitter<HostEvents> {
    return this.#events
  }

  constructor(params: ContextHostParams = {}) {
    // Wire host cleanup into the Disposer lifecycle, so it runs on `dispose()` and on abort alike.
    super({
      dispose: async () => {
        await this.#disposeHost()
        await params.dispose?.()
      },
    })
    this.#elicit = params.elicit
    this.#payloads = params.tracing?.payloads ?? 'off'
    this.#parentFrom = params.tracing?.parentFrom
    this.#connectivity = params.connectivity
  }

  get contexts(): Record<string, HostedContext> {
    return this.#contexts
  }

  get elicitationEnabled(): boolean {
    return this.#elicit != null
  }

  handleElicitation(handler: HostElicitOverride): () => void {
    if (!this.elicitationEnabled) {
      throw new Error('Elicitation is not enabled for this host')
    }
    if (this.#elicitOverride != null) {
      throw new Error('Elicitation handler already installed')
    }
    const override = { handler }
    this.#elicitOverride = override
    return () => {
      if (this.#elicitOverride === override) {
        this.#elicitOverride = undefined
      }
    }
  }

  // Subclasses in `@mokei/host-node` bind this internal dispatcher for stdio contexts.
  // biome-ignore lint/style/useConsistentMemberAccessibility: subclasses must access this protected hook
  protected createElicitHandler(params: {
    key: string
    elicit?: false
  }): ElicitHandler | undefined {
    if (!this.elicitationEnabled || params.elicit === false) {
      return undefined
    }
    return ({ params: requestParams, signal }) =>
      this.#hostElicit({ key: params.key, params: requestParams, signal })
  }

  /** The host-wide elicitation path: the `handleElicitation` override, then the base handler. */
  async #hostElicit(request: HostElicitRequest): Promise<ElicitResult> {
    const override = this.#elicitOverride
    if (override != null) {
      return await override.handler(request, (options) =>
        this.#dispatchElicitation({
          ...request,
          signal: options?.signal ?? request.signal,
        }),
      )
    }
    return await this.#dispatchElicitation(request)
  }

  /** Adapts a per-call handler to the client's per-request handler for one context. */
  #perCallElicit(key: string, elicit?: HostElicitOverride): ElicitHandler | undefined {
    if (elicit == null) return undefined
    return ({ params, signal }) =>
      elicit({ key, params, signal }, (options) =>
        this.#hostElicit({ key, params, signal: options?.signal ?? signal }),
      )
  }

  async #dispatchElicitation(request: HostElicitRequest): Promise<ElicitResult> {
    if (typeof this.#elicit === 'function') {
      return this.#elicit(request)
    }
    return { action: 'decline' }
  }

  /**
   * Get the map of registered local tools.
   */
  get localTools(): Map<string, LocalTool> {
    return this.#localTools
  }

  async #disposeHost(): Promise<void> {
    this.#elicitOverride = undefined
    this.#localTools.clear()
    await Promise.all(Object.keys(this.#contexts).map((key) => this.remove(key)))
  }

  /** Check whether a context key is already registered. */
  hasContext(params: HasContextParams): boolean {
    return this.#contexts[params.key] != null
  }

  /** Register a hosted context created by a subclass. */
  registerHostedContext(params: RegisterHostedContextParams): void {
    if (this.hasContext({ key: params.key })) {
      throw new Error(`Context ${params.key} already exists`)
    }
    this.#register(params.key, params.context, {
      transport: params.transport ?? 'direct',
      reconnect: params.reconnect,
    })
  }

  /** Stores a registration and wires its first client. */
  #register(key: string, context: HostedContext, params: RegisterParams): void {
    const state: RegistrationState = {
      transport: params.transport,
      subscriptions: { desired: new Set(), tail: Promise.resolve() },
      url: params.url,
      httpTransport: params.httpTransport,
    }
    if (params.reconnect != null) {
      state.controller = this.#createController(key, context, state, params.reconnect)
    }
    this.#contexts[key] = context
    this.#registrations.set(context, state)
    state.spanContext = this.#wireContextSubscriptions(
      key,
      context.client,
      params.transport,
      params.httpTransport,
      params.url,
    )
  }

  #createController(
    key: string,
    registration: HostedContext,
    state: RegistrationState,
    reconnect: { options: ReconnectOptions; factory: ContextFactory },
  ): ReconnectController {
    let lostSpanContext: SpanContext | undefined
    return new ReconnectController({
      key,
      options: reconnect.options,
      factory: reconnect.factory,
      connectivity: this.#connectivity,
      hooks: {
        quiesce: (error) => {
          lostSpanContext = state.spanContext
          state.spanContext = undefined
          this.#detachClient(key, 'lost')
          const transport = state.httpTransport
          // Teardown of a lost generation never opens a sign-in.
          transport?.setInteractive(false)
          if (transport != null && isSessionExpiry(error)) {
            // The server already dropped the session: no `DELETE` for it. Disposed ahead of the
            // client so the client's own transport dispose below finds it done.
            void transport.dispose({ terminateSession: false }).catch(() => {})
          }
          // In the background: disposal never waits on, or depends on, a replacement.
          void registration.disposer.dispose().catch(() => {})
        },
        commit: (parts, tools, generation, attempt) => {
          if (this.#contexts[key] !== registration) {
            return null
          }
          const merged = mergeContextTools(key, registration.tools, tools)
          const toolsChanged = !sameToolDefinitions(registration.tools, merged)
          registration.client = parts.client
          registration.disposer = parts.disposer
          registration.tools = merged
          state.httpTransport = parts.transport
          parts.transport?.setInteractive(true)
          state.spanContext = this.#wireContextSubscriptions(
            key,
            parts.client,
            state.transport,
            parts.transport,
            state.url,
            { link: lostSpanContext, attempt },
          )
          lostSpanContext = undefined
          this.#restoreSubscriptions(key, registration, state, parts.client, generation)
          return { toolsChanged }
        },
        fail: (error) => {
          if (this.#contexts[key] !== registration) {
            return
          }
          void this.#events.emit('context:failed', { key, error }).catch(() => {})
          // Listeners run synchronously and may have removed (and re-added) the key.
          if (this.#contexts[key] !== registration) {
            return
          }
          void this.remove(key, 'lost').catch(() => {})
        },
        emit: (name, payload) => {
          // ReconnectEvents is a subset of HostEvents.
          void this.#events.emit(name, payload as HostEvents[typeof name]).catch(() => {})
        },
      },
    })
  }

  /** Ends the current client's context span and detaches its host listeners. */
  #detachClient(key: string, reason: TerminationReason): void {
    this.#contextSettlers.get(key)?.(reason)
    this.#contextSettlers.delete(key)
    for (const unsubscribe of this.#subscriptionUnsubscribes.get(key) ?? []) {
      unsubscribe()
    }
    this.#subscriptionUnsubscribes.delete(key)
  }

  /** The reconnect generation of a registration (`undefined` without reconnect). */
  #generationOf(registration: HostedContext): number | undefined {
    return this.#registrations.get(registration)?.controller?.generation
  }

  /**
   * Whether `registration` is still the key's, `client` still its current client and no loss
   * happened since `generation` was read.
   */
  #owns(
    key: string,
    registration: HostedContext,
    client: ContextClient,
    generation: number | undefined,
  ): boolean {
    return (
      this.#contexts[key] === registration &&
      registration.client === client &&
      this.#generationOf(registration) === generation
    )
  }

  /**
   * Reports that `client`, the current client of `key`, lost its connection. A context armed for
   * reconnect is rebuilt; any other is removed. Reports for a client that is not current are
   * ignored.
   */
  // biome-ignore lint/style/useConsistentMemberAccessibility: subclasses must access this protected hook
  protected reportLoss(key: string, client: ContextClient, error: Error): void {
    const registration = this.#contexts[key]
    if (registration == null || registration.client !== client) {
      return
    }
    const controller = this.#registrations.get(registration)?.controller
    if (controller?.armed) {
      controller.lose(controller.generation, error)
      return
    }
    void this.remove(key, 'lost').catch((cause: unknown) => {
      const failure = cause instanceof Error ? cause : new Error(String(cause))
      void this.#events.emit('context:failed', { key, error: failure }).catch(() => {})
    })
  }

  /**
   * A transport reported its connection lost. Only a context armed for reconnect acts on it;
   * any other keeps today's behaviour (the next request fails on its own).
   */
  #reportConnectionLoss(key: string, client: ContextClient, error: Error): void {
    const registration = this.#contexts[key]
    if (registration == null || registration.client !== client) {
      return
    }
    if (this.#registrations.get(registration)?.controller?.armed) {
      this.reportLoss(key, client, error)
    }
  }

  getContextKeys(): Array<string> {
    return Object.keys(this.#contexts)
  }

  getContext<T extends ContextTypes = UnknownContextTypes>(key: string): HostedContext<T> {
    const ctx = this.#contexts[key]
    if (ctx == null) {
      throw new Error(`Context ${key} does not exist`)
    }
    return ctx as unknown as HostedContext<T>
  }

  setContextTools(params: SetContextToolsParams): void {
    this.getContext(params.key).tools = params.tools
  }

  #mapContextTools(key: string, fn: (tool: ContextTool) => ContextTool): Array<ContextTool> {
    const tools = this.getContext(key).tools.map(fn)
    this.setContextTools({ key, tools })
    return tools
  }

  disableContextTools(params: ContextToolNamesParams): Array<ContextTool> {
    return this.#mapContextTools(params.key, (ct) => {
      return params.toolNames.includes(ct.tool.name) ? { ...ct, enabled: false } : ct
    })
  }

  enableContextTools(params: ContextToolNamesParams): Array<ContextTool> {
    return this.#mapContextTools(params.key, (ct) => {
      return params.toolNames.includes(ct.tool.name) ? { ...ct, enabled: true } : ct
    })
  }

  setEnabledContextTools(params: ContextToolNamesParams): Array<ContextTool> {
    return this.#mapContextTools(params.key, (ct) => {
      return params.toolNames.includes(ct.tool.name)
        ? { ...ct, enabled: true }
        : { ...ct, enabled: false }
    })
  }

  getEnabledTools(): Array<ContextTool> {
    return Object.values(this.#contexts)
      .flatMap((ctx) => ctx.tools)
      .filter((tool) => tool.enabled)
  }

  getCallableTools(): Array<Tool> {
    const tools: Array<Tool> = []

    // Add context tools
    for (const ctx of Object.values(this.#contexts)) {
      for (const ct of ctx.tools) {
        if (ct.enabled) {
          tools.push({ ...ct.tool, name: ct.id })
        }
      }
    }

    // Add local tools (always enabled)
    for (const [name, localTool] of this.#localTools) {
      tools.push({ ...localTool.tool, name: createLocalToolID(name) })
    }

    return tools
  }

  /**
   * Register a local tool that can be called without an MCP server.
   * Local tools are namespaced as `local:toolName`.
   *
   * @example
   * ```typescript
   * host.addLocalTool({
   *   name: 'calculate',
   *   description: 'Evaluate a math expression',
   *   inputSchema: {
   *     type: 'object',
   *     properties: { expression: { type: 'string' } },
   *     required: ['expression']
   *   },
   *   execute: async ({ arguments: { expression } }) => {
   *     const result = eval(expression)
   *     return { content: [{ type: 'text', text: String(result) }] }
   *   }
   * })
   * ```
   */
  addLocalTool(definition: LocalToolDefinition): void {
    if (this.#localTools.has(definition.name)) {
      throw new Error(`Local tool "${definition.name}" already exists`)
    }
    this.#localTools.set(definition.name, {
      tool: createToolFromDefinition(definition),
      execute: definition.execute,
    })
  }

  /**
   * Register multiple local tools at once.
   */
  addLocalTools(definitions: Array<LocalToolDefinition>): void {
    for (const def of definitions) {
      this.addLocalTool(def)
    }
  }

  /**
   * Remove a local tool by name.
   */
  removeLocalTool(name: string): boolean {
    return this.#localTools.delete(name)
  }

  /**
   * Check if a local tool exists.
   */
  hasLocalTool(name: string): boolean {
    return this.#localTools.has(name)
  }

  /**
   * Get a local tool by name.
   */
  getLocalTool(name: string): LocalTool | undefined {
    return this.#localTools.get(name)
  }

  createContext<T extends ContextTypes = UnknownContextTypes>(
    params: CreateContextParams,
  ): ContextClient<T> {
    const { key, elicit, ...hostedParams } = params
    if (this.#contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const context = createHostedContext<T>({
      ...hostedParams,
      elicit: this.createElicitHandler({ key, elicit }),
    })
    this.#register(key, context as unknown as HostedContext, {
      transport: params.transport instanceof HTTPTransport ? 'http' : 'direct',
      httpTransport: params.transport instanceof HTTPTransport ? params.transport : undefined,
    })
    return context.client
  }

  addDirectContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddDirectContextParams,
  ): ContextClient<T> {
    const { key, config, tools, protocolVersion, elicit } = params
    if (this.#contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // One generation: a fresh transport pair and server from the same `config`.
    const build = (initialTools?: Array<ContextTool>): HostedContext<T> => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const server = new ContextServer({ ...config, transport: transports.server })
      return createHostedContext<T>({
        transport: transports.client,
        tools: initialTools,
        protocolVersion,
        elicit: this.createElicitHandler({ key, elicit }),
        dispose: async () => {
          await Promise.all([server.dispose(), transports.client.dispose()])
        },
      })
    }
    const options = resolveReconnectOptions(params.reconnect)
    const context = build(tools)
    this.#register(key, context as unknown as HostedContext, {
      transport: 'direct',
      reconnect:
        options == null
          ? undefined
          : {
              options,
              factory: async () => {
                const { client, disposer } = build()
                return { client: client as unknown as ContextClient, disposer }
              },
            },
    })
    void this.#events.emit('context:added', { key }).catch(() => {})
    return context.client
  }

  /**
   * Add a context that connects to a remote MCP server via HTTP.
   *
   * This implements the MCP Streamable HTTP transport specification,
   * supporting session management and both JSON and SSE responses.
   *
   * @example
   * ```typescript
   * // Basic HTTP connection
   * const client = await host.addHTTPContext({
   *   key: 'remote-api',
   *   url: 'https://mcp.example.com/api',
   * })
   *
   * // With authentication
   * const client = await host.addHTTPContext({
   *   key: 'authenticated-api',
   *   url: 'https://mcp.example.com/api',
   *   auth: { type: 'bearer', token: 'your-api-key' },
   *   timeout: 60000,
   * })
   *
   * // Setup tools after connecting
   * const tools = await host.setup({ key: 'remote-api' })
   * ```
   */
  async addHTTPContext<T extends ContextTypes = UnknownContextTypes>(
    params: HTTPContextParams,
  ): Promise<ContextClient<T>> {
    const { key, url, headers, auth, timeout, protocolVersion, fetchMiddleware, runtime, elicit } =
      params

    if (this.#contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Built through `createHostedContext` rather than assembled here so the default revision is
    // named in exactly one place. Spelling it a second time is the literal-as-capability
    // pattern this revision's work set out to remove, and a one-sided change to it would be a
    // behaviour difference between two entry points that read as siblings.
    // One generation: a new transport and client from the same params (`'auto'` re-probes).
    const build = (interactive?: boolean) => {
      const transport = new HTTPTransport({
        url,
        headers,
        auth,
        timeout,
        fetchMiddleware,
        runtime,
        interactive,
      })
      const context = createHostedContext<T>({
        transport: transport as ClientTransport,
        protocolVersion,
        elicit: this.createElicitHandler({ key, elicit }),
      })
      return { transport, context }
    }
    const options = resolveReconnectOptions(params.reconnect)
    const { transport, context } = build()

    this.#register(key, context as unknown as HostedContext, {
      transport: 'http',
      httpTransport: transport,
      url,
      reconnect:
        options == null
          ? undefined
          : {
              options,
              // Candidates never open a sign-in; the commit makes the winner interactive.
              factory: async () => {
                const candidate = build(false)
                return {
                  client: candidate.context.client as unknown as ContextClient,
                  disposer: candidate.context.disposer,
                  transport: candidate.transport,
                }
              },
            },
    })
    void this.#events.emit('context:added', { key }).catch(() => {})

    return context.client
  }

  /**
   * Subscribes to a context client's `2026-07-28` subscription signals (SEP-1391) and turns them
   * into {@link HostEvents}. These client events only ever fire on the `2026-07-28`
   * `subscriptions/listen` stream -- a `2025-11-25` client never emits them -- so wiring every
   * context is safe and only `2026-07-28` contexts ever react. On a `*ListChanged` signal the host
   * re-discovers the affected list (refreshing the namespaced tool aggregate for tools) *before*
   * emitting `<x>:changed`; on `resourceUpdated` it forwards `resource:updated` without re-reading.
   * It also forwards `2025-11-25` `elicitationComplete` as `elicitation:complete`.
   */
  #wireContextSubscriptions(
    key: string,
    client: ContextClient,
    transport: ContextTransport = 'direct',
    httpTransport?: HTTPTransport,
    url?: string,
    reconnect?: { link?: SpanContext; attempt: number },
  ): SpanContext {
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
      payloads: this.#payloads,
      ...(this.#parentFrom === undefined ? {} : { parentFrom: this.#parentFrom }),
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
    this.#contextSettlers.set(key, (reason) => {
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
    })
    const unsubscribes = [
      client.events.on('initialized', ({ serverInfo }) => {
        if (settled) return
        span.setAttribute('mokei.server.name', serverInfo.name)
        const version = currentProtocolVersion(client)
        if (version !== undefined) span.setAttribute('mcp.protocol.version', version)
        if (httpTransport?.sessionID != null)
          span.setAttribute('mcp.session.id', httpTransport.sessionID)
      }),
      client.events.on('closed', ({ error }) => {
        this.reportLoss(
          key,
          client,
          error ?? new TransportClosedError({ message: 'Context client closed' }),
        )
      }),
      client.events.on('toolsListChanged', () => {
        void this.#onListChanged(key, 'tools')
      }),
      client.events.on('promptsListChanged', () => {
        void this.#onListChanged(key, 'prompts')
      }),
      client.events.on('resourcesListChanged', () => {
        void this.#onListChanged(key, 'resources')
      }),
      client.events.on('resourceUpdated', ({ uri }) => {
        void this.#events.emit('resource:updated', { key, uri }).catch(() => {})
      }),
      client.events.on('elicitationComplete', ({ elicitationId }) => {
        void this.#events.emit('elicitation:complete', { key, elicitationId }).catch(() => {})
      }),
    ]
    if (httpTransport != null) {
      unsubscribes.push(
        httpTransport.connectionEvents.on('connection', (event) => {
          this.#reportConnectionLoss(key, client, connectionLossError(event))
        }),
      )
    }
    this.#subscriptionUnsubscribes.set(key, unsubscribes)
    return span.spanContext()
  }

  /**
   * Re-lists the affected list for a context whose server signalled a change, then emits the
   * matching `<kind>:changed` event. The re-list refreshes the host's namespaced aggregate for
   * tools; prompts/resources have no host-side aggregate, so their re-list refreshes the client's
   * discovery snapshot. The re-list is best-effort: even on failure, emit the
   * change signal consumers act on. Bails if the context was removed while
   * a frame was in flight.
   */
  async #onListChanged(key: string, kind: 'tools' | 'prompts' | 'resources'): Promise<void> {
    const registration = this.#contexts[key]
    if (registration == null) {
      return
    }
    const client = registration.client
    const generation = this.#generationOf(registration)
    try {
      if (kind === 'tools') {
        await this.#refreshContextTools(key)
      } else if (kind === 'prompts') {
        await client.listPrompts()
      } else {
        await client.listResources()
      }
    } catch {
      // Best-effort re-list; still emit the change signal below.
    }
    // Removed, re-added or reconnected meanwhile: the signal belongs to a client that is gone.
    if (!this.#owns(key, registration, client, generation)) {
      return
    }
    void this.#events.emit(`${kind}:changed`, { key }).catch(() => {})
  }

  /**
   * Re-lists a context's tools and rebuilds its namespaced aggregate, preserving each surviving
   * tool's `enabled`/`allow` state by name, defaulting new tools to enabled, and dropping tools the
   * server no longer advertises.
   */
  async #refreshContextTools(key: string): Promise<void> {
    const registration = this.#contexts[key]
    if (registration == null) {
      return
    }
    const client = registration.client
    const generation = this.#generationOf(registration)
    const { tools } = await client.listTools()
    if (!this.#owns(key, registration, client, generation)) {
      return
    }
    registration.tools = mergeContextTools(key, registration.tools, tools)
  }

  async setup(params: SetupParams): Promise<Array<ContextTool>> {
    const { key, enableTools = true, ...listOptions } = params
    const registration = this.getContext(key)
    const controller = this.#registrations.get(registration)?.controller
    if (controller?.armed && controller.state === 'reconnecting') {
      return await this.#currentToolsAfterReconnect(key, registration, controller, listOptions)
    }
    const client = registration.client
    const generation = controller?.generation
    // Lost (and maybe rebuilt) while this setup awaited: its result belongs to a gone client.
    const superseded = () => controller != null && controller.generation !== generation
    let tools: Array<Tool>
    try {
      ;({ tools } = await client.listTools(listOptions))
    } catch (err) {
      // If the context was removed while listTools was in flight, surface a clear error.
      if (this.#contexts[key] !== registration) {
        throw new Error(`Context ${key} was removed during setup`, { cause: err })
      }
      if (superseded()) {
        return await this.#currentToolsAfterReconnect(key, registration, controller, listOptions)
      }
      throw err
    }
    // Check before handing consumer code the tools: a superseded discovery is never shown.
    if (this.#contexts[key] !== registration) {
      throw new Error(`Context ${key} was removed during setup`)
    }
    if (registration.client !== client || superseded()) {
      return await this.#currentToolsAfterReconnect(key, registration, controller, listOptions)
    }
    const enabledTools = typeof enableTools === 'function' ? await enableTools(tools) : enableTools
    const contextTools = tools.map((tool: Tool) => {
      const enabled =
        typeof enabledTools === 'boolean' ? enabledTools : enabledTools.includes(tool.name)
      return { id: getContextToolID(key, tool.name), tool, enabled }
    })
    // The context may have been removed while listTools / enableTools awaited.
    if (this.#contexts[key] !== registration) {
      throw new Error(`Context ${key} was removed during setup`)
    }
    if (registration.client !== client || superseded()) {
      return await this.#currentToolsAfterReconnect(key, registration, controller, listOptions)
    }
    registration.tools = contextTools
    controller?.arm()
    return contextTools
  }

  /** Waits out a reconnect, then returns the registration's tools as they are now. */
  async #currentToolsAfterReconnect(
    key: string,
    registration: HostedContext,
    controller: ReconnectController | undefined,
    options: { signal?: AbortSignal; timeout?: number },
  ): Promise<Array<ContextTool>> {
    if (controller != null && controller.state === 'reconnecting') {
      const budget = Math.min(controller.gateTimeoutMs, options.timeout ?? Number.POSITIVE_INFINITY)
      try {
        await controller.waitForGate({ signal: options.signal, deadline: Date.now() + budget })
      } catch (err) {
        if (this.#contexts[key] !== registration) {
          throw new Error(`Context ${key} was removed during setup`, { cause: err })
        }
        throw err
      }
    }
    if (this.#contexts[key] !== registration) {
      throw new Error(`Context ${key} was removed during setup`)
    }
    return registration.tools
  }

  async remove(key: string, reason: TerminationReason = 'stopped'): Promise<void> {
    const ctx = this.#contexts[key]
    if (ctx == null) {
      return
    }
    // Delete before the async dispose so a concurrent remove/dispose (e.g. an
    // onExit reap racing a user remove) sees null and exits -- no double removal.
    delete this.#contexts[key]
    // Stops a reconnect in flight: no swap, no events, gate waiters fail.
    this.#registrations
      .get(ctx)
      ?.controller?.abort(new Error(`Context ${key} was removed (${reason})`))
    // Settle the context span and tear down the client subscription-event listeners (SEP-1391)
    // before disposing the client. A context lost mid-reconnect has neither left.
    this.#detachClient(key, reason)

    await ctx.disposer.dispose()
    void this.#events.emit('context:removed', { key }).catch(() => {})
  }

  /**
   * Subscribes to a resource's updates (`2026-07-28`). Resolves once the server acknowledges it;
   * only then is the URI recorded, so a context added with `reconnect` subscribes to it again on
   * each new connection. Changes for one context run one at a time, in call order.
   */
  subscribeResource(params: ContextResourceSubscriptionParams): Promise<void> {
    const { key, uri, signal } = params
    const registration = this.getContext(key)
    const { subscriptions } = this.#stateOf(registration)
    return this.#enqueueSubscription(subscriptions, async () => {
      await this.#sendSubscriptionChange(key, registration, signal, (client, timeout) =>
        client.subscribeResource({ uri, signal, timeout }),
      )
      if (this.#contexts[key] === registration) {
        subscriptions.desired.add(uri)
      }
    })
  }

  /**
   * Unsubscribes from a resource's updates. The URI stops being restored at once, even while a
   * restoration is running; if the server refuses the change the URI is kept, as the client keeps
   * it, and the call rejects.
   */
  unsubscribeResource(params: ContextResourceSubscriptionParams): Promise<void> {
    const { key, uri, signal } = params
    const registration = this.getContext(key)
    const { subscriptions } = this.#stateOf(registration)
    // Removed now rather than when the queue reaches this change, so a restoration ahead of it
    // in the queue skips the URI.
    let wasDesired = subscriptions.desired.delete(uri)
    return this.#enqueueSubscription(subscriptions, async () => {
      // A subscribe queued ahead of this change may have recorded it since.
      wasDesired = subscriptions.desired.delete(uri) || wasDesired
      try {
        await this.#sendSubscriptionChange(key, registration, signal, (client, timeout) =>
          client.unsubscribeResource({ uri, signal, timeout }),
        )
      } catch (error) {
        // The client commits only acknowledged filters, so it keeps whatever it had: keep the URI
        // here only if the current client still has it (a restoration may have skipped it), and a
        // reconnect restores it.
        if (
          wasDesired &&
          this.#contexts[key] === registration &&
          hasResourceSubscription(registration.client, uri)
        ) {
          subscriptions.desired.add(uri)
        }
        throw error
      }
    })
  }

  #stateOf(registration: HostedContext): RegistrationState {
    // Every registration gets its state in `#register`.
    return this.#registrations.get(registration) as RegistrationState
  }

  #enqueueSubscription(
    subscriptions: ResourceSubscriptions,
    task: () => Promise<void>,
  ): Promise<void> {
    const run = subscriptions.tail.then(task)
    subscriptions.tail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  /** Sends a subscription change, through the gate when the context can reconnect. */
  async #sendSubscriptionChange(
    key: string,
    registration: HostedContext,
    signal: AbortSignal | undefined,
    send: GatedSend<void>,
  ): Promise<void> {
    if (this.#contexts[key] !== registration) {
      throw new ContextUnavailableError({
        key,
        cause: new Error(`Context ${key} was removed while the change waited`),
      })
    }
    const controller = this.#stateOf(registration).controller
    if (controller == null) {
      await send(registration.client, undefined)
      return
    }
    await this.#gated(key, registration, controller, { signal }, { send })
  }

  /**
   * Subscribes the new client of a reconnected context to the desired URIs, one at a time, in the
   * subscription queue. The gate is already open: calls never wait for this. URIs unsubscribed
   * meanwhile are skipped, and it stops when the client stops being current. A URI the new server
   * refuses (or cannot subscribe to) is dropped with `resource:subscription-lost`. Restoration
   * never opens a sign-in: the HTTP transport always sends `subscriptions/listen` non-interactive.
   */
  #restoreSubscriptions(
    key: string,
    registration: HostedContext,
    state: RegistrationState,
    client: ContextClient,
    generation: number,
  ): void {
    const { subscriptions } = state
    void this.#enqueueSubscription(subscriptions, async () => {
      // Read from the discovery snapshot, not a request: a request here could open a sign-in.
      const supported = client.discoveredCapabilities?.resources?.subscribe === true
      for (const uri of Array.from(subscriptions.desired)) {
        if (!this.#owns(key, registration, client, generation)) return
        if (!subscriptions.desired.has(uri)) continue
        if (!supported) {
          subscriptions.desired.delete(uri)
          const error = new Error(`Context ${key}'s server does not support resource subscriptions`)
          void this.#events.emit('resource:subscription-lost', { key, uri, error }).catch(() => {})
          continue
        }
        try {
          await client.subscribeResource({ uri })
        } catch (cause) {
          if (!this.#owns(key, registration, client, generation)) return
          const error = cause instanceof Error ? cause : new Error(String(cause))
          if (isLossError(cause)) {
            // Lost again: the URI stays desired for the next connection.
            state.controller?.lose(generation, error)
            return
          }
          subscriptions.desired.delete(uri)
          void this.#events.emit('resource:subscription-lost', { key, uri, error }).catch(() => {})
        }
      }
    })
  }

  getPrompt<T extends ContextTypes = UnknownContextTypes>(
    params: ContextPromptParams<T>,
  ): Promise<GetPromptResult> {
    const { key, elicit, ...promptParams } = params
    const registration = this.getContext<T>(key)
    const send = (client: ContextClient<T>, timeout: number | undefined) =>
      client.getPrompt({
        ...(promptParams as PromptParams<T>),
        ...(timeout === undefined ? {} : { timeout }),
        elicit: this.#perCallElicit(key, elicit),
      })
    const controller = this.#registrations.get(registration as unknown as HostedContext)?.controller
    if (controller == null) {
      return send(registration.client, promptParams.timeout)
    }
    return this.#gated(key, registration as unknown as HostedContext, controller, promptParams, {
      send: send as unknown as GatedSend<GetPromptResult>,
    })
  }

  callTool<T extends ContextTypes = UnknownContextTypes>(
    params: ContextToolParams<T>,
  ): Promise<CallToolResult> {
    const { key, elicit, ...toolParams } = params
    const registration = this.getContext<T>(key)
    const send = (client: ContextClient<T>, timeout: number | undefined) =>
      client.callTool({
        ...(toolParams as ToolParams<T>),
        ...(timeout === undefined ? {} : { timeout }),
        elicit: this.#perCallElicit(key, elicit),
      })
    const controller = this.#registrations.get(registration as unknown as HostedContext)?.controller
    if (controller == null) {
      return send(registration.client, toolParams.timeout)
    }
    return this.#gated(key, registration as unknown as HostedContext, controller, toolParams, {
      send: send as unknown as GatedSend<CallToolResult>,
      toolName: toolParams.name as string,
    })
  }

  /**
   * Runs a request on a context that can reconnect. One deadline is taken at entry (from
   * `timeout`; none without one): a reconnect is waited out at the gate within it, and the request
   * then runs with what is left. The registration is re-read before dispatch and must still be the
   * one the call started on. A read-only tool call (`toolName`) lost in flight with its
   * generation is retried once on the new client.
   */
  async #gated<R>(
    key: string,
    registration: HostedContext,
    controller: ReconnectController,
    options: { signal?: AbortSignal; timeout?: number },
    request: { send: GatedSend<R>; toolName?: string },
  ): Promise<R> {
    const { signal, timeout } = options
    const deadline = timeout == null ? Number.POSITIVE_INFINITY : Date.now() + timeout
    let retried = false
    for (;;) {
      if (signal?.aborted) throw signal.reason
      // Aborts are checked again on wake inside `waitForGate`, where an abort wins the race.
      await controller.waitForGate({ signal, deadline })
      if (signal?.aborted) throw signal.reason
      if (this.#contexts[key] !== registration) {
        throw new ContextUnavailableError({
          key,
          cause: new Error(`Context ${key} was removed while the request waited`),
        })
      }
      // Lost again between the gate opening and this wake: wait for the next gate, same deadline.
      if (controller.state === 'reconnecting') continue
      const client = registration.client
      const generation = controller.generation
      // Read from the generation the call is sent on: a retry trusts the lost one's listing.
      const readOnly =
        request.toolName != null &&
        registration.tools.find((ct) => ct.tool.name === request.toolName)?.tool.annotations
          ?.readOnlyHint === true
      // One clock read: the budget checked is the budget sent.
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new ContextUnavailableError({
          key,
          cause: new Error(`Context ${key} reconnected after the request's deadline`),
        })
      }
      try {
        return await request.send(client, timeout == null ? undefined : remaining)
      } catch (error) {
        if (!isLossError(error)) {
          throw error
        }
        // The loss may surface on the call before the transport or client reports it. Ignored
        // when it was already reported or the context is not armed (never removes an unarmed
        // context).
        controller.lose(generation, error as Error)
        if (
          retried ||
          !readOnly ||
          signal?.aborted ||
          // The server accepted a task: running the call again would run it twice.
          error instanceof TaskInterruptedError ||
          controller.generation === generation ||
          deadline - Date.now() <= 0
        ) {
          throw error
        }
        retried = true
      }
    }
  }

  callNamespacedTool(params: NamespacedToolParams): Promise<CallToolResult> {
    const { id, arguments: args = {}, _meta, signal, timeout, traceAttributes, elicit } = params

    // Check if this is a local tool
    if (isLocalToolID(id)) {
      return this.callLocalTool({
        name: getLocalToolName(id),
        arguments: args,
        _meta: _meta as Record<string, JSONValue> | undefined,
        signal,
        traceAttributes,
      })
    }

    const [key, name] = getContextToolInfo(id)
    return this.callTool({
      key,
      name,
      arguments: args,
      _meta,
      signal,
      timeout,
      traceAttributes,
      elicit,
    }).catch((error: unknown) => {
      // The agent path sees an unavailable context as a tool error, like a failing local tool.
      if (error instanceof ContextUnavailableError) {
        return { isError: true, content: [{ type: 'text' as const, text: error.message }] }
      }
      throw error
    })
  }

  /** Call a local tool by name. Local tools run in-process, so there is no request to time out. */
  async callLocalTool(params: LocalToolParams): Promise<CallToolResult> {
    const { name, arguments: args = {}, _meta, signal, traceAttributes } = params

    const localTool = this.#localTools.get(name)
    if (localTool == null) {
      throw new Error(`Local tool "${name}" does not exist`)
    }
    if (signal?.aborted) {
      throw signal.reason
    }

    const capture = resolveContentCapture(this.#payloads)
    const span = getMokeiTracer('host').startSpan(`execute_tool ${name}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': name,
        'gen_ai.tool.type': 'function',
        ...(localTool.tool.description === undefined
          ? {}
          : { 'gen_ai.tool.description': localTool.tool.description }),
        ...traceAttributes,
      },
    })
    // Serializing and redacting payloads is costly; skip it for unsampled or no-op spans.
    const recording = span.isRecording()
    const setContent = (key: string, value: unknown): void => {
      const captured = capturePayload(value, capture)
      if (captured === undefined) return
      span.setAttribute(key, captured.payload)
      if (captured.truncated) span.setAttribute('mokei.payload.truncated', true)
    }
    if (recording) setContent('gen_ai.tool.call.arguments', args)
    try {
      // The call carries `arguments` (wire vocabulary); the handler receives `input`.
      const result = await localTool.execute({ input: args, meta: _meta ?? {}, signal })
      if (result.isError === true) {
        endSpanError(span, 'tool_error')
      } else {
        if (recording) setContent('gen_ai.tool.call.result', result)
        span.end()
      }
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      endSpanError(span, errorTypeOf(error), errorMessage, capture)
      return {
        content: [{ type: 'text' as const, text: errorMessage }],
        isError: true,
      }
    }
  }
}
