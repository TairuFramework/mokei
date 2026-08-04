import { NodeStreamsTransport } from '@enkaku/node-streams'
import { DirectTransports } from '@enkaku/transport'
import {
  type ClientTransport,
  ContextClient,
  type ContextTypes,
  type ListParams,
  type PromptParams,
  type ToolParams,
  type UnknownContextTypes,
  UnsupportedProtocolVersionError,
} from '@mokei/context-client'
import type {
  CallToolResult,
  ClientMessage,
  GetPromptResult,
  Metadata,
  ProtocolVersion,
  ServerMessage,
  Tool,
} from '@mokei/context-protocol'
import { isSupportedProtocolVersion } from '@mokei/context-protocol'
import type { WithRequestOptions } from '@mokei/context-rpc'
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { type HTTPAuthOptions, HTTPTransport } from '@mokei/http-client'
import { Disposer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'

import {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  type LocalTool,
  type LocalToolDefinition,
} from './local-tools.js'
import { isSubprocessExit, type SpawnContextServerParams, spawnContextServer } from './spawn.js'

export type EnableTools = boolean | Array<string>
export type EnableToolsFn = (tools: Array<Tool>) => EnableTools | Promise<EnableTools>
export type EnableToolsArg = EnableTools | EnableToolsFn

/** Default cap on total live stdout framer memory per context (8 MiB). */
const DEFAULT_MAX_BUFFER_SIZE = 8 * 1024 * 1024

/** Grace period (ms) between SIGTERM and SIGKILL when disposing a child. */
const DEFAULT_KILL_TIMEOUT = 5000

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
  dispose?: () => void | Promise<void>
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export type CreateContextParams = CreateHostedContextParams & {
  key: string
}

export type HostEvents = {
  'context:added': { key: string }
  'context:removed': { key: string }
  'context:failed': { key: string; error: Error }
}

export function createHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: CreateHostedContextParams,
): HostedContext<T> {
  // `'auto'` rather than the newest revision: a host points at arbitrary third-party servers,
  // most of which serve `'2025-11-25'` only, and a `'2026-07-28'` pin rejects those with
  // `-32022` instead of negotiating down. Callers that know their server pin explicitly.
  const { transport, tools = [], dispose, protocolVersion = 'auto' } = params
  const client = new ContextClient<T>({ protocolVersion, transport })
  const disposer = new Disposer({
    dispose: async () => {
      await transport.dispose()
      await dispose?.()
    },
  })
  return { client, disposer, tools }
}

export type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
  /** Called when the stdout framing/read stream faults (invalid JSON or buffer overflow). */
  onStreamError?: (error: Error) => void
  /** Max total live framer memory in bytes. Default 8 MiB. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. Default unset (= buffer cap). */
  maxMessageSize?: number
  /** Grace period (ms) between SIGTERM and SIGKILL on dispose. Default 5000. */
  killTimeout?: number
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export async function spawnHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: SpawnHostedContextParams,
): Promise<HostedContext<T>> {
  const {
    onExit,
    onStreamError,
    maxBufferSize,
    maxMessageSize,
    killTimeout,
    protocolVersion,
    ...spawnParams
  } = params
  // Validated before spawning: `ContextClient`'s constructor also rejects an unsupported pin,
  // but only after `createHostedContext` builds it below — by which point the child would
  // already be running with no disposer wired up to reap it. Same predicate the client uses, so
  // the supported-version list is not duplicated here.
  if (
    protocolVersion != null &&
    protocolVersion !== 'auto' &&
    !isSupportedProtocolVersion(protocolVersion)
  ) {
    throw new UnsupportedProtocolVersionError(protocolVersion)
  }
  const { childProcess, streams, subprocess } = await spawnContextServer(spawnParams)
  if (onExit != null) {
    subprocess.then(
      () => onExit(null),
      (error) => onExit(error as Error),
    )
  }
  const transport = new NodeStreamsTransport({
    streams,
    maxBufferSize: maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    maxMessageSize,
    onInvalidJSON: (value, controller) => {
      // Strict: a server that can't speak clean JSONL is broken. Turn the bad
      // line into a stream error so it surfaces as `readFailed` and reaps the
      // context, instead of silently vanishing.
      controller.error(new Error(`Invalid JSON on context stdout: ${value.slice(0, 200)}`))
    },
  })
  // Single seam: every fatal framing fault (invalid JSON or buffer overflow)
  // surfaces here. No child kill — the host's reap disposes the transport (via
  // the dispose below), which kills the child, so handling the fault here would
  // only duplicate that teardown.
  transport.events.on('readFailed', ({ error }) => {
    onStreamError?.(error)
  })
  return createHostedContext({
    transport: transport as ClientTransport,
    protocolVersion,
    dispose: async () => {
      // Already exited — nothing to reap.
      if (childProcess.exitCode != null || childProcess.signalCode != null) {
        return
      }
      await new Promise<void>((resolve) => {
        let killTimer: ReturnType<typeof setTimeout>
        childProcess.once('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
        childProcess.kill('SIGTERM')
        killTimer = setTimeout(() => {
          // Child ignored SIGTERM; force it. The `exit` listener above still
          // resolves once the kill lands.
          childProcess.kill('SIGKILL')
        }, killTimeout ?? DEFAULT_KILL_TIMEOUT)
      })
    },
  })
}

export type AddDirectContextParams = {
  key: string
  config: ServerConfig
  tools?: Array<ContextTool>
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
  /** Override the default 8 MiB stdout framer memory cap. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. */
  maxMessageSize?: number
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
}

export class ContextHost extends Disposer {
  /** @internal */
  _contexts: Record<string, HostedContext> = {}
  /** @internal */
  _localTools: Map<string, LocalTool> = new Map()
  /** @internal */
  _events: EventEmitter<HostEvents> = new EventEmitter<HostEvents>()

  get events(): EventEmitter<HostEvents> {
    return this._events
  }

  constructor() {
    // Wire `_dispose()` into the Disposer lifecycle: the base only runs the
    // `dispose` function it is given, so without this `_dispose()` (which tears
    // down contexts and, in ProxyHost, the daemon client) would never run.
    super({ dispose: () => this._dispose() })
  }

  get contexts(): Record<string, HostedContext> {
    return this._contexts
  }

  /**
   * Get the map of registered local tools.
   */
  get localTools(): Map<string, LocalTool> {
    return this._localTools
  }

  /** @internal */
  async _dispose(): Promise<void> {
    this._localTools.clear()
    await Promise.all(Object.keys(this._contexts).map((key) => this.remove(key)))
  }

  getContextKeys(): Array<string> {
    return Object.keys(this._contexts)
  }

  getContext<T extends ContextTypes = UnknownContextTypes>(key: string): HostedContext<T> {
    const ctx = this._contexts[key]
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
    return Object.values(this._contexts)
      .flatMap((ctx) => ctx.tools)
      .filter((tool) => tool.enabled)
  }

  getCallableTools(): Array<Tool> {
    const tools: Array<Tool> = []

    // Add context tools
    for (const ctx of Object.values(this._contexts)) {
      for (const ct of ctx.tools) {
        if (ct.enabled) {
          tools.push({ ...ct.tool, name: ct.id })
        }
      }
    }

    // Add local tools (always enabled)
    for (const [name, localTool] of this._localTools) {
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
    if (this._localTools.has(definition.name)) {
      throw new Error(`Local tool "${definition.name}" already exists`)
    }
    this._localTools.set(definition.name, {
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
    return this._localTools.delete(name)
  }

  /**
   * Check if a local tool exists.
   */
  hasLocalTool(name: string): boolean {
    return this._localTools.has(name)
  }

  /**
   * Get a local tool by name.
   */
  getLocalTool(name: string): LocalTool | undefined {
    return this._localTools.get(name)
  }

  createContext<T extends ContextTypes = UnknownContextTypes>(
    params: CreateContextParams,
  ): ContextClient<T> {
    const { key, ...hostedParams } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const context = createHostedContext<T>(hostedParams)
    this._contexts[key] = context as unknown as HostedContext
    return context.client
  }

  addDirectContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddDirectContextParams,
  ): ContextClient<T> {
    const { key, config, tools, protocolVersion } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })
    return this.createContext({
      key,
      transport: transports.client,
      tools,
      protocolVersion,
      dispose: async () => {
        await Promise.all([server.dispose(), transports.client.dispose()])
      },
    })
  }

  async addLocalContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddLocalContextParams,
  ): Promise<ContextClient<T>> {
    const { key, ...spawnParams } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Set once when a framing fault is handled, so the follow-up `onExit` (from
    // the kill during reap) doesn't emit a second `context:failed`.
    let framingError: Error | null = null
    const context = await spawnHostedContext<T>({
      ...spawnParams,
      onStreamError: (error) => {
        // A framing fault only occurs while the read loop is actively pulling
        // the child's stdout — i.e. during a request the host drove (setup /
        // callTool). At that point the entry is still registered, so a present
        // entry is the normal case here. An idle context never reaches this:
        // with no consumer, the child's output is held by OS pipe backpressure
        // (bounded by the kernel pipe buffer, not host memory), so a flood from
        // an unused server cannot overflow the framer or exhaust the host.
        //
        // The `null` check guards the remaining teardown case: a `readFailed`
        // that lands after the entry is already gone (disposal, or the
        // re-rejection our own remove() causes) is noise, not a fault — this is
        // what keeps a clean remove() from emitting a bogus context:failed.
        if (this._contexts[key] == null) {
          return
        }
        framingError = error
        void this._events.emit('context:failed', { key, error }).catch(() => {})
        void this.remove(key).catch(() => {})
      },
      onExit: (error) => {
        if (framingError != null) {
          return
        }
        if (error != null && !isSubprocessExit(error)) {
          void this._events.emit('context:failed', { key, error }).catch(() => {})
        }
        void this.remove(key).catch(() => {})
      },
    })
    this._contexts[key] = context as unknown as HostedContext
    void this._events.emit('context:added', { key }).catch(() => {})
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
    const { key, url, headers, auth, timeout, protocolVersion } = params

    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Built through `createHostedContext` rather than assembled here so the default revision is
    // named in exactly one place. Spelling it a second time is the literal-as-capability
    // pattern this revision's work set out to remove, and a one-sided change to it would be a
    // behavior difference between two entry points that read as siblings.
    const context = createHostedContext<T>({
      transport: new HTTPTransport({ url, headers, auth, timeout }) as ClientTransport,
      protocolVersion,
    })

    this._contexts[key] = context as unknown as HostedContext

    return context.client
  }

  async setup(params: SetupParams): Promise<Array<ContextTool>> {
    const { key, enableTools = true, ...listOptions } = params
    const { tools } = await this.getContext(key)
      .client.listTools(listOptions)
      .catch((err: unknown) => {
        // If the context was removed while listTools was in flight, surface a clear error.
        if (this._contexts[key] == null) {
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
    if (this._contexts[key] == null) {
      throw new Error(`Context ${key} was removed during setup`)
    }
    this._contexts[key].tools = contextTools
    return contextTools
  }

  async remove(key: string): Promise<void> {
    const ctx = this._contexts[key]
    if (ctx == null) {
      return
    }
    // Delete before the async dispose so a concurrent remove/dispose (e.g. an
    // onExit reap racing a user remove) sees null and exits — no double removal.
    delete this._contexts[key]

    await ctx.disposer.dispose()
    void this._events.emit('context:removed', { key }).catch(() => {})
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
      return this.callLocalTool({ name: getLocalToolName(id), arguments: args, signal })
    }

    const [key, name] = getContextToolInfo(id)
    return this.callTool({ key, name, arguments: args, _meta, signal, timeout })
  }

  /** Call a local tool by name. Local tools run in-process, so there is no request to time out. */
  async callLocalTool(params: LocalToolParams): Promise<CallToolResult> {
    const { name, arguments: args = {}, signal } = params

    const localTool = this._localTools.get(name)
    if (localTool == null) {
      throw new Error(`Local tool "${name}" does not exist`)
    }
    if (signal?.aborted) {
      throw signal.reason
    }

    try {
      // The call carries `arguments` (wire vocabulary); the handler receives `input`.
      return await localTool.execute({ input: args, signal })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: errorMessage }],
        isError: true,
      }
    }
  }
}
