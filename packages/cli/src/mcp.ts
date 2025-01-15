import { type Disposer, createDisposer } from '@enkaku/util'
import { type ClientTransport, ContextClient } from '@mokei/context-client'
import type { CallToolResult, Tool } from '@mokei/context-protocol'
import type { Subprocess } from 'nano-spawn'

import { createTransport, spawnServer } from './host/mcp.js'

type AllowToolCalls = 'always' | 'ask' | 'never'

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

export type ContextTool = {
  id: string
  tool: Tool
  enabled: boolean
  allow?: AllowToolCalls
}

type ActiveContext = {
  client: ContextClient
  subprocess: Subprocess
  transport: ClientTransport
  tools: Array<ContextTool>
}

export class ContextHost implements Disposer {
  #contexts: Record<string, ActiveContext> = {}
  #disposer: Disposer

  constructor() {
    this.#disposer = createDisposer(async () => {
      await Promise.all(Object.keys(this.#contexts).map((key) => this.remove(key)))
    })
  }

  get contexts(): Record<string, ActiveContext> {
    return this.#contexts
  }

  get disposed(): Promise<void> {
    return this.#disposer.disposed
  }

  async dispose(): Promise<void> {
    await this.#disposer.dispose()
  }

  getContextKeys(): Array<string> {
    return Object.keys(this.#contexts)
  }

  getContext(key: string): ActiveContext {
    const ctx = this.#contexts[key]
    if (ctx == null) {
      throw new Error(`Context ${key} does not exist`)
    }
    return ctx
  }

  setContextTools(key: string, tools: Array<ContextTool>): void {
    this.getContext(key).tools = tools
  }

  getEnabledTools(): Array<ContextTool> {
    return Object.values(this.#contexts)
      .flatMap((ctx) => ctx.tools)
      .filter((tool) => tool.enabled)
  }

  async spawn(key: string, command: string, args: Array<string> = []): Promise<ContextClient> {
    if (this.#contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const spawned = await spawnServer(command, args)
    const transport = createTransport(spawned)
    const client = new ContextClient({ transport })
    this.#contexts[key] = { client, subprocess: spawned.subprocess, transport, tools: [] }
    return client
  }

  async setup(key: string): Promise<Array<ContextTool>> {
    const tools = await this.getContext(key).client.listTools()
    const contextTools = tools.map((tool) => {
      return { id: getContextToolID(key, tool.name), tool, enabled: true }
    })
    this.#contexts[key].tools = contextTools
    return contextTools
  }

  async remove(key: string): Promise<void> {
    const ctx = this.#contexts[key]
    if (ctx == null) {
      return
    }

    await ctx.transport.dispose()
    const childProcess = await ctx.subprocess.nodeChildProcess
    childProcess.kill()
  }

  async callTool(
    key: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    return await this.getContext(key).client.callTool(name, args)
  }
}
