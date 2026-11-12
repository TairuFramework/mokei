import { DirectTransports } from '@enkaku/transport'
import {
  type ClientTransport,
  type ContextClient,
  type ContextTypes,
  capturePayload,
  type ElicitHandler,
  endSpanError,
  errorTypeOf,
  getMokeiTracer,
  type PayloadCapture,
  type PromptParams,
  resolveContentCapture,
  type TerminationReason,
  type ToolParams,
  type TraceParentFrom,
  transportFailureOf,
  type UnknownContextTypes,
} from '@mokei/context-client'
import type {
  CallToolResult,
  ClientMessage,
  ElicitResult,
  GetPromptResult,
  ServerMessage,
  Tool,
} from '@mokei/context-protocol'
import { TransportClosedError } from '@mokei/context-rpc'
import { ContextServer, type JSONValue } from '@mokei/context-server'
import { type ConnectionEvent, HTTPTransport, SessionExpiredError } from '@mokei/http-client'
import { type SpanContext, SpanKind } from '@opentelemetry/api'
import { Disposer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'

import { startContextSpan } from './context-span.js'
import { ContextUnavailableError } from './errors.js'
import { type GatedSend, runGated } from './gate.js'
import { createHostedContext, type HostedContext } from './hosted-context.js'
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
  type ReconnectOptions,
  resolveReconnectOptions,
} from './reconnect.js'
import { ContextSubscriptions, type ResourceSubscriptions } from './subscriptions.js'
import {
  type ContextTool,
  getContextToolID,
  getContextToolInfo,
  mergeContextTools,
  sameToolDefinitions,
} from './tools.js'
import type {
  AddDirectContextParams,
  ContextHostParams,
  ContextPromptParams,
  ContextResourceSubscriptionParams,
  ContextToolNamesParams,
  ContextToolParams,
  ContextTransport,
  CreateContextParams,
  HasContextParams,
  HostElicitHandler,
  HostElicitOverride,
  HostElicitRequest,
  HostEvents,
  HTTPContextParams,
  LocalToolParams,
  NamespacedToolParams,
  RegisterHostedContextParams,
  SetContextToolsParams,
  SetupParams,
} from './types.js'

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
  #subscriptions = new ContextSubscriptions({
    isRegistered: (key, registration) => this.#contexts[key] === registration,
    owns: (key, registration, client, generation) => {
      return this.#owns(key, registration, client, generation)
    },
    stateOf: (registration) => this.#stateOf(registration),
    onLost: (event) => {
      void this.#events.emit('resource:subscription-lost', event).catch(() => {})
    },
  })

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
          this.#subscriptions.restore(key, registration, state, parts.client, generation)
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

  #stateOf(registration: HostedContext): RegistrationState {
    // Every registration gets its state in `#register`.
    return this.#registrations.get(registration) as RegistrationState
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
   * Whether `key`'s reconnect is armed: added with `reconnect` and set up, so a loss reported
   * through {@link reportLoss} rebuilds it instead of removing it.
   */
  // biome-ignore lint/style/useConsistentMemberAccessibility: subclasses must access this protected hook
  protected isReconnectArmed(key: string): boolean {
    const registration = this.#contexts[key]
    return registration != null && this.#registrations.get(registration)?.controller?.armed === true
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
    const span = startContextSpan({
      key,
      client,
      transport,
      httpTransport,
      url,
      payloads: this.#payloads,
      parentFrom: this.#parentFrom,
      reconnect,
    })
    this.#contextSettlers.set(key, span.settle)
    const unsubscribes = [
      client.events.on('initialized', span.onInitialized),
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
    return span.spanContext
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
    return this.#subscriptions.subscribe(key, this.getContext(key), uri, signal)
  }

  /**
   * Unsubscribes from a resource's updates. The URI stops being restored at once, even while a
   * restoration is running; if the server refuses the change the URI is kept, as the client keeps
   * it, and the call rejects.
   */
  unsubscribeResource(params: ContextResourceSubscriptionParams): Promise<void> {
    const { key, uri, signal } = params
    return this.#subscriptions.unsubscribe(key, this.getContext(key), uri, signal)
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

  /** Runs a request through the reconnect gate (see `runGated`). */
  #gated<R>(
    key: string,
    registration: HostedContext,
    controller: ReconnectController,
    options: { signal?: AbortSignal; timeout?: number },
    request: { send: GatedSend<R>; toolName?: string },
  ): Promise<R> {
    return runGated({
      key,
      registration,
      controller,
      isRegistered: () => this.#contexts[key] === registration,
      options,
      request,
    })
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
