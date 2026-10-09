import { DirectTransports } from '@enkaku/transport'
import {
  type ClientTransport,
  ContextClient,
  type ContextTypes,
  type ElicitHandler,
  type ListParams,
  type PayloadCapture,
  type PromptParams,
  type TerminationReason,
  type ToolParams,
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
import type { WithRequestOptions } from '@mokei/context-rpc'
import { ContextServer, type JSONValue, type ServerConfig } from '@mokei/context-server'
import { type FetchMiddleware, type HTTPAuthOptions, HTTPTransport } from '@mokei/http-client'
import { ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api'
import { Disposer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'
import { createTracerFactory } from '@sozai/otel'

import {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  type LocalTool,
  type LocalToolDefinition,
} from './local-tools.js'

const createTracer = createTracerFactory('mokei')
type ContextTransport = 'stdio' | 'http' | 'direct'

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

/** Parameters for getting a prompt from a context, keyed by context. */
export type ContextPromptParams<T extends ContextTypes = UnknownContextTypes> = WithRequestOptions<
  PromptParams<T>
> & { key: string }

/** Parameters for calling a tool on a context, keyed by context. */
export type ContextToolParams<T extends ContextTypes = UnknownContextTypes> = WithRequestOptions<
  ToolParams<T>
> & { key: string }

/** Parameters for calling a tool by its namespaced ID (`contextKey:toolName` or `local:toolName`). */
export type NamespacedToolParams = WithRequestOptions<{
  id: string
  arguments?: Record<string, unknown>
  _meta?: Metadata
}>

/** Parameters for calling a local tool. Local tools run in-process, so they take no `timeout`. */
export type LocalToolParams = {
  name: string
  arguments?: Record<string, unknown>
  _meta?: Record<string, JSONValue>
  signal?: AbortSignal
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
  tracing?: { payloads?: PayloadCapture }
}

export type HasContextParams = { key: string }
export type RegisterHostedContextParams = {
  key: string
  context: HostedContext
  transport?: ContextTransport
}

export type HostEvents = {
  'context:added': { key: string }
  'context:removed': { key: string }
  'context:failed': { key: string; error: Error }
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
}

export class ContextHost extends Disposer {
  #contexts: Record<string, HostedContext> = {}
  #payloads?: PayloadCapture
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
    return ({ params: requestParams, signal }) => {
      const request = { key: params.key, params: requestParams, signal }
      const override = this.#elicitOverride
      if (override != null) {
        return override.handler(request, (options) =>
          this.#dispatchElicitation({
            ...request,
            signal: options?.signal ?? request.signal,
          }),
        )
      }
      return this.#dispatchElicitation(request)
    }
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
    this.#contexts[params.key] = params.context
    this.#wireContextSubscriptions(params.key, params.context.client, params.transport)
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
    this.#contexts[key] = context as unknown as HostedContext
    this.#wireContextSubscriptions(
      key,
      context.client as unknown as ContextClient,
      params.transport instanceof HTTPTransport ? 'http' : 'direct',
      params.transport instanceof HTTPTransport ? params.transport : undefined,
    )
    return context.client
  }

  addDirectContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddDirectContextParams,
  ): ContextClient<T> {
    const { key, config, tools, protocolVersion, elicit } = params
    if (this.#contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })
    return this.createContext({
      key,
      transport: transports.client,
      tools,
      protocolVersion,
      elicit,
      dispose: async () => {
        await Promise.all([server.dispose(), transports.client.dispose()])
      },
    })
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
    const { key, url, headers, auth, timeout, protocolVersion, fetchMiddleware, elicit } = params

    if (this.#contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Built through `createHostedContext` rather than assembled here so the default revision is
    // named in exactly one place. Spelling it a second time is the literal-as-capability
    // pattern this revision's work set out to remove, and a one-sided change to it would be a
    // behaviour difference between two entry points that read as siblings.
    const transport = new HTTPTransport({
      url,
      headers,
      auth,
      timeout,
      fetchMiddleware,
    })
    const context = createHostedContext<T>({
      transport: transport as ClientTransport,
      protocolVersion,
      elicit: this.createElicitHandler({ key, elicit }),
    })

    this.#contexts[key] = context as unknown as HostedContext
    this.#wireContextSubscriptions(
      key,
      context.client as unknown as ContextClient,
      'http',
      transport,
    )

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
  ): void {
    const span = createTracer('host').startSpan(
      'mcp.context',
      {
        attributes: {
          'mokei.kind': 'context',
          'mokei.root': true,
          'mokei.context.id': key,
          'mcp.transport': transport,
        },
      },
      ROOT_CONTEXT,
    )
    client.setTracing({
      contextID: key,
      contextSpan: span,
      payloads: this.#payloads,
      getSessionID: () => httpTransport?.sessionID ?? undefined,
    })
    if (client.initializationResult != null)
      span.setAttribute('server.name', client.initializationResult.serverInfo.name)
    let settled = false
    this.#contextSettlers.set(key, (reason) => {
      if (settled) return
      settled = true
      client.endTracing(reason)
      if (httpTransport?.sessionID != null)
        span.setAttribute('mcp.session.id', httpTransport.sessionID)
      if (reason === 'lost') span.setAttribute('error.type', 'context.lost')
      span.setStatus({ code: reason === 'lost' ? SpanStatusCode.ERROR : SpanStatusCode.OK })
      span.end()
    })
    const unsubscribes = [
      client.events.on('initialized', ({ serverInfo }) => {
        if (settled) return
        span.setAttribute('server.name', serverInfo.name)
        if (httpTransport?.sessionID != null)
          span.setAttribute('mcp.session.id', httpTransport.sessionID)
      }),
      client.events.on('closed', () => {
        if (this.#contexts[key]?.client === client)
          void this.remove(key, 'lost').catch((cause: unknown) => {
            const error = cause instanceof Error ? cause : new Error(String(cause))
            void this.#events.emit('context:failed', { key, error }).catch(() => {})
          })
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
    this.#subscriptionUnsubscribes.set(key, unsubscribes)
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
    const ctx = this.#contexts[key]
    if (ctx == null) {
      return
    }
    try {
      if (kind === 'tools') {
        await this.#refreshContextTools(key)
      } else if (kind === 'prompts') {
        await ctx.client.listPrompts()
      } else {
        await ctx.client.listResources()
      }
    } catch {
      // Best-effort re-list; still emit the change signal below.
    }
    if (this.#contexts[key] == null) {
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
    const ctx = this.#contexts[key]
    if (ctx == null) {
      return
    }
    const { tools } = await ctx.client.listTools()
    if (this.#contexts[key] == null) {
      return
    }
    const previous = new Map(ctx.tools.map((ct) => [ct.tool.name, ct]))
    ctx.tools = tools.map((tool: Tool) => {
      const prior = previous.get(tool.name)
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

  async setup(params: SetupParams): Promise<Array<ContextTool>> {
    const { key, enableTools = true, ...listOptions } = params
    const context = this.getContext(key)
    const { tools } = await context.client.listTools(listOptions).catch((err: unknown) => {
      // If the context was removed while listTools was in flight, surface a clear error.
      if (this.#contexts[key] !== context) {
        throw new Error(`Context ${key} was removed during setup`)
      }
      throw err
    })
    const enabledTools = typeof enableTools === 'function' ? await enableTools(tools) : enableTools
    const contextTools = tools.map((tool: Tool) => {
      const enabled =
        typeof enabledTools === 'boolean' ? enabledTools : enabledTools.includes(tool.name)
      return { id: getContextToolID(key, tool.name), tool, enabled }
    })
    // The context may have been removed while listTools / enableTools awaited.
    if (this.#contexts[key] !== context) {
      throw new Error(`Context ${key} was removed during setup`)
    }
    context.tools = contextTools
    return contextTools
  }

  async remove(key: string, reason: TerminationReason = 'stopped'): Promise<void> {
    const ctx = this.#contexts[key]
    if (ctx == null) {
      return
    }
    // Delete before the async dispose so a concurrent remove/dispose (e.g. an
    // onExit reap racing a user remove) sees null and exits -- no double removal.
    delete this.#contexts[key]
    this.#contextSettlers.get(key)?.(reason)
    this.#contextSettlers.delete(key)

    // Tear down the client subscription-event listeners (SEP-1391) before disposing the client.
    for (const unsubscribe of this.#subscriptionUnsubscribes.get(key) ?? []) {
      unsubscribe()
    }
    this.#subscriptionUnsubscribes.delete(key)

    await ctx.disposer.dispose()
    void this.#events.emit('context:removed', { key }).catch(() => {})
  }

  getPrompt<T extends ContextTypes = UnknownContextTypes>(
    params: ContextPromptParams<T>,
  ): Promise<GetPromptResult> {
    const { key, ...promptParams } = params
    return this.getContext<T>(key).client.getPrompt(promptParams as PromptParams<T>)
  }

  callTool<T extends ContextTypes = UnknownContextTypes>(
    params: ContextToolParams<T>,
  ): Promise<CallToolResult> {
    const { key, ...toolParams } = params
    return this.getContext<T>(key).client.callTool(toolParams as ToolParams<T>)
  }

  callNamespacedTool(params: NamespacedToolParams): Promise<CallToolResult> {
    const { id, arguments: args = {}, _meta, signal, timeout } = params

    // Check if this is a local tool
    if (isLocalToolID(id)) {
      return this.callLocalTool({
        name: getLocalToolName(id),
        arguments: args,
        _meta: _meta as Record<string, JSONValue> | undefined,
        signal,
      })
    }

    const [key, name] = getContextToolInfo(id)
    return this.callTool({ key, name, arguments: args, _meta, signal, timeout })
  }

  /** Call a local tool by name. Local tools run in-process, so there is no request to time out. */
  async callLocalTool(params: LocalToolParams): Promise<CallToolResult> {
    const { name, arguments: args = {}, _meta, signal } = params

    const localTool = this.#localTools.get(name)
    if (localTool == null) {
      throw new Error(`Local tool "${name}" does not exist`)
    }
    if (signal?.aborted) {
      throw signal.reason
    }

    try {
      // The call carries `arguments` (wire vocabulary); the handler receives `input`.
      return await localTool.execute({ input: args, meta: _meta ?? {}, signal })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: errorMessage }],
        isError: true,
      }
    }
  }
}
