import { type CallToolResult, isCreateTaskResult } from '@mokei/context-protocol'
import type { JSONValue } from '@mokei/context-server'
import type { ContextHost } from '@mokei/host'
import { raceAttempt, TimeoutInterruption } from '@sozai/async'
import type { Schema } from '@sozai/schema'

export type CatalogTool = { id: string; inputSchema: Schema; outputSchema?: Schema }
export type ToolCallOutcome = { result: CallToolResult } | { task: { taskId: string } }
export type ToolCaller = {
  listTools(): Array<CatalogTool>
  callTool(params: {
    id: string
    arguments: Record<string, JSONValue>
    meta: Record<string, JSONValue>
    signal: AbortSignal
  }): Promise<ToolCallOutcome>
  waitTask(params: { id: string; taskId: string; signal: AbortSignal }): Promise<CallToolResult>
  cancelTask(params: { id: string; taskId: string }): Promise<void>
}

export const SIBLING_CANCEL_TIMEOUT_MS = 5_000

export async function cancelSibling(
  caller: ToolCaller,
  target: { id: string; taskId: string },
): Promise<void> {
  try {
    await raceAttempt({
      fn: () => caller.cancelTask(target),
      timeoutMs: SIBLING_CANCEL_TIMEOUT_MS,
    })
  } catch (error) {
    if (error instanceof TimeoutInterruption) {
      throw new Error('Sibling cancellation timed out', { cause: error })
    }
    throw error
  }
}

export class ToolUnavailableError extends Error {
  get code(): 'tool_unavailable' {
    return 'tool_unavailable'
  }

  constructor(id: string) {
    super(`Tool unavailable: ${id}`)
    this.name = 'ToolUnavailableError'
  }
}

const decisionFlowContexts = new WeakMap<ContextHost, Set<string>>()

function isLocalToolID(id: string): boolean {
  return id.startsWith('local:')
}

function getContextToolInfo(id: string): [string, string] {
  const separator = id.indexOf(':')
  if (separator < 0) throw new ToolUnavailableError(id)
  return [id.slice(0, separator), id.slice(separator + 1)]
}

export function markDecisionFlowContext(host: ContextHost, key: string): void {
  let keys = decisionFlowContexts.get(host)
  if (keys == null) {
    keys = new Set()
    decisionFlowContexts.set(host, keys)
  }
  keys.add(key)
}

export function unmarkDecisionFlowContext(host: ContextHost, key: string): void {
  decisionFlowContexts.get(host)?.delete(key)
}

export function hostToolCaller(
  host: ContextHost,
  options: { exclude?: Array<string> } = {},
): ToolCaller {
  function listTools(): Array<CatalogTool> {
    const excluded = new Set([
      ...(options.exclude ?? []),
      ...(decisionFlowContexts.get(host) ?? []),
    ])
    return host.getCallableTools().flatMap((tool) => {
      const id = tool.name
      if (!isLocalToolID(id)) {
        const [key] = getContextToolInfo(id)
        if (excluded.has(key)) return []
        const contextTool = host.contexts[key]?.tools.find((entry) => entry.id === id)
        if (contextTool == null || contextTool.allow === 'never') return []
        return [
          {
            id,
            inputSchema: contextTool.tool.inputSchema,
            outputSchema: contextTool.tool.outputSchema,
          },
        ]
      }
      return [{ id, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }]
    })
  }

  function contextFor(id: string) {
    if (isLocalToolID(id)) throw new ToolUnavailableError(id)
    const [key] = getContextToolInfo(id)
    const context = host.contexts[key]
    if (context == null) throw new ToolUnavailableError(id)
    return context
  }

  return {
    listTools,
    async callTool({ id, arguments: args, meta, signal }) {
      if (!listTools().some((tool) => tool.id === id)) throw new ToolUnavailableError(id)
      if (isLocalToolID(id)) {
        const result = await host.callLocalTool({
          name: id.slice('local:'.length),
          arguments: args,
          _meta: meta,
          signal,
        })
        return { result }
      }
      const [, name] = getContextToolInfo(id)
      const result = await contextFor(id).client.callTool({
        name,
        arguments: args,
        _meta: meta,
        signal,
        task: 'handle',
      })
      return isCreateTaskResult(result) ? { task: { taskId: result.taskId } } : { result }
    },
    waitTask({ id, taskId, signal }) {
      return contextFor(id).client.tasks.wait(taskId, { signal })
    },
    async cancelTask({ id, taskId }) {
      await contextFor(id).client.tasks.cancel(taskId)
    },
  }
}
