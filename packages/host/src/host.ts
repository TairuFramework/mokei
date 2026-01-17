import { Disposer } from '@enkaku/async'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import { DirectTransports } from '@enkaku/transport'
import {
  type ClientTransport,
  ContextClient,
  type ContextTypes,
  type PromptParams,
  type ToolParams,
  type UnknownContextTypes,
} from '@mokei/context-client'
import type {
  CallToolResult,
  ClientMessage,
  GetPromptResult,
  Metadata,
  ServerMessage,
  Tool,
} from '@mokei/context-protocol'
import type { SentRequest } from '@mokei/context-rpc'
import { ContextServer, type ServerConfig } from '@mokei/context-server'

import type { HttpContextParams } from './http-context.js'
import { McpHttpTransport } from './http-transport.js'
import {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  type LocalTool,
  type LocalToolDefinition,
} from './local-tools.js'
import { type SpawnContextServerParams, spawnContextServer } from './spawn.js'

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
}

export type CreateContextParams = CreateHostedContextParams & {
  key: string
}

export function createHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: CreateHostedContextParams,
): HostedContext<T> {
  const { transport, tools = [], dispose } = params
  const client = new ContextClient<T>({ transport })
  const disposer = new Disposer({
    dispose: async () => {
      await transport.dispose()
      await dispose?.()
    },
  })
  return { client, disposer, tools }
}

export async function spawnHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: SpawnContextServerParams,
): Promise<HostedContext<T>> {
  const { childProcess, streams } = await spawnContextServer(params)
  const transport = new NodeStreamsTransport({ streams }) as ClientTransport
  return createHostedContext({
    transport,
    dispose: () => {
      childProcess.kill()
    },
  })
}

export type AddDirectContextParams = {
  key: string
  config: ServerConfig
  tools?: Array<ContextTool>
}

export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
}

export class ContextHost extends Disposer {
  /** @internal */
  _contexts: Record<string, HostedContext> = {}
  /** @internal */
  _localTools: Map<string, LocalTool> = new Map()

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

  setContextTools(key: string, tools: Array<ContextTool>): void {
    this.getContext(key).tools = tools
  }

  #mapContextTools(key: string, fn: (tool: ContextTool) => ContextTool): Array<ContextTool> {
    const newTools = this.getContext(key).tools.map(fn)
    this.setContextTools(key, newTools)
    return newTools
  }

  disableContextTools(key: string, toolNames: Array<string>): Array<ContextTool> {
    return this.#mapContextTools(key, (ct) => {
      return toolNames.includes(ct.tool.name) ? { ...ct, enabled: false } : ct
    })
  }

  enableContextTools(key: string, toolNames: Array<string>): Array<ContextTool> {
    return this.#mapContextTools(key, (ct) => {
      return toolNames.includes(ct.tool.name) ? { ...ct, enabled: true } : ct
    })
  }

  setEnabledContextTools(key: string, toolNames: Array<string>): Array<ContextTool> {
    return this.#mapContextTools(key, (ct) => {
      return toolNames.includes(ct.tool.name) ? { ...ct, enabled: true } : { ...ct, enabled: false }
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
   *   execute: async ({ expression }) => {
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
    const { key, config, tools } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({ ...config, transport: transports.server })
    return this.createContext({
      key,
      transport: transports.client,
      tools,
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

    const context = await spawnHostedContext<T>(spawnParams)
    this._contexts[key] = context as unknown as HostedContext
    return context.client
  }

  /**
   * Add a context that connects to a remote MCP server via HTTP.
   *
   * @example
   * ```typescript
   * // Basic HTTP connection
   * const client = await host.addHttpContext({
   *   key: 'remote-api',
   *   url: 'https://mcp.example.com/api',
   * })
   *
   * // With authentication
   * const client = await host.addHttpContext({
   *   key: 'authenticated-api',
   *   url: 'https://mcp.example.com/api',
   *   auth: { type: 'bearer', token: 'your-api-key' },
   *   timeout: 60000,
   * })
   *
   * // Setup tools after connecting
   * const tools = await host.setup('remote-api')
   * ```
   */
  /**
   * Add a context that connects to a remote MCP server via HTTP.
   *
   * This implements the MCP Streamable HTTP transport specification,
   * supporting session management and both JSON and SSE responses.
   *
   * @example
   * ```typescript
   * // Basic HTTP connection
   * const client = await host.addHttpContext({
   *   key: 'remote-api',
   *   url: 'https://mcp.example.com/api',
   * })
   *
   * // With authentication
   * const client = await host.addHttpContext({
   *   key: 'authenticated-api',
   *   url: 'https://mcp.example.com/api',
   *   auth: { type: 'bearer', token: 'your-api-key' },
   *   timeout: 60000,
   * })
   *
   * // Setup tools after connecting
   * const tools = await host.setup('remote-api')
   * ```
   */
  async addHttpContext<T extends ContextTypes = UnknownContextTypes>(
    params: HttpContextParams<T>,
  ): Promise<ContextClient<T>> {
    const { key, url, headers, auth, timeout } = params

    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Create MCP HTTP transport
    const transport = new McpHttpTransport({ url, headers, auth, timeout })

    // Create the context client
    const client = new ContextClient<T>({ transport: transport as ClientTransport })

    // Create disposer for cleanup
    const disposer = new Disposer({
      dispose: async () => {
        await transport.dispose()
      },
    })

    // Store the hosted context
    this._contexts[key] = {
      client: client as unknown as ContextClient,
      disposer,
      tools: [],
    }

    return client
  }

  async setup(key: string, enableTools: EnableToolsArg = true): Promise<Array<ContextTool>> {
    const { tools } = await this.getContext(key).client.listTools()
    const enabledTools = typeof enableTools === 'function' ? await enableTools(tools) : enableTools
    const contextTools = tools.map((tool: Tool) => {
      const enabled =
        typeof enabledTools === 'boolean' ? enabledTools : enabledTools.includes(tool.name)
      return { id: getContextToolID(key, tool.name), tool, enabled }
    })
    this._contexts[key].tools = contextTools
    return contextTools
  }

  async remove(key: string): Promise<void> {
    const ctx = this._contexts[key]
    if (ctx == null) {
      return
    }

    await ctx.disposer.dispose()
    delete this._contexts[key]
  }

  getPrompt<T extends ContextTypes = UnknownContextTypes>(
    key: string,
    params: PromptParams<T>,
  ): SentRequest<GetPromptResult> {
    return this.getContext<T>(key).client.getPrompt(params)
  }

  callTool<T extends ContextTypes = UnknownContextTypes>(
    key: string,
    params: ToolParams<T>,
  ): SentRequest<CallToolResult> {
    return this.getContext<T>(key).client.callTool(params)
  }

  callNamespacedTool(
    id: string,
    args: Record<string, unknown> = {},
    metadata?: Metadata,
  ): SentRequest<CallToolResult> {
    // Check if this is a local tool
    if (isLocalToolID(id)) {
      return this.callLocalTool(getLocalToolName(id), args)
    }

    const [key, name] = getContextToolInfo(id)
    return this.callTool(key, { name, arguments: args, _meta: metadata })
  }

  /**
   * Call a local tool by name.
   * Returns a SentRequest-like object for consistency with context tool calls.
   */
  callLocalTool(name: string, args: Record<string, unknown> = {}): SentRequest<CallToolResult> {
    const localTool = this._localTools.get(name)
    if (localTool == null) {
      throw new Error(`Local tool "${name}" does not exist`)
    }

    // Create a promise-based result that matches the SentRequest interface
    let cancelled = false
    const promise = Promise.resolve().then(async () => {
      if (cancelled) {
        throw new Error('Request cancelled')
      }
      try {
        const result = await localTool.execute(args)
        return result
      } catch (error) {
        // Convert errors to CallToolResult with isError flag
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: errorMessage }],
          isError: true,
        }
      }
    })

    // Create a minimal SentRequest-compatible object
    const request = promise as SentRequest<CallToolResult>
    request.cancel = () => {
      cancelled = true
    }
    return request
  }
}
