import { Disposer } from '@enkaku/async'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import {
  type ClientRequest,
  type ClientTransport,
  ContextClient,
  type ContextTypes,
  type UnknownContextTypes,
} from '@mokei/context-client'
import type { CallToolResult, GetPromptResult, Tool } from '@mokei/context-protocol'

import { spawnContextServer } from './spawn.js'

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

export async function createHostedContext<T extends ContextTypes = UnknownContextTypes>(
  command: string,
  args: Array<string> = [],
): Promise<HostedContext<T>> {
  const { childProcess, streams } = await spawnContextServer(command, args)
  const transport = new NodeStreamsTransport({ streams }) as ClientTransport
  const client = new ContextClient<T>({ transport })
  const disposer = new Disposer({
    dispose: async () => {
      await transport.dispose()
      childProcess.kill()
    },
  })
  return { client, disposer, tools: [] }
}

export class ContextHost extends Disposer {
  /** @internal */
  _contexts: Record<string, HostedContext> = {}

  get contexts(): Record<string, HostedContext> {
    return this._contexts
  }

  /** @internal */
  async _dispose(): Promise<void> {
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
    return ctx as HostedContext<T>
  }

  setContextTools(key: string, tools: Array<ContextTool>): void {
    this.getContext(key).tools = tools
  }

  getEnabledTools(): Array<ContextTool> {
    return Object.values(this._contexts)
      .flatMap((ctx) => ctx.tools)
      .filter((tool) => tool.enabled)
  }

  async spawn(key: string, command: string, args: Array<string> = []): Promise<ContextClient> {
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const context = await createHostedContext(command, args)
    this._contexts[key] = context
    return context.client
  }

  async setup(key: string): Promise<Array<ContextTool>> {
    const tools = await this.getContext(key).client.listTools()
    const contextTools = tools.map((tool) => {
      return { id: getContextToolID(key, tool.name), tool, enabled: true }
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

  getPrompt(
    key: string,
    name: string,
    args: Record<string, unknown> = {},
  ): ClientRequest<GetPromptResult> {
    return this.getContext(key).client.getPrompt(name, args)
  }

  callTool(
    key: string,
    name: string,
    args: Record<string, unknown>,
  ): ClientRequest<CallToolResult> {
    return this.getContext(key).client.callTool(name, args)
  }
}
