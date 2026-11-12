import type { Tool } from '@mokei/context-protocol'

export type EnableTools = boolean | Array<string>
export type EnableToolsFn = (tools: Array<Tool>) => EnableTools | Promise<EnableTools>
export type EnableToolsArg = EnableTools | EnableToolsFn

export type AllowToolCalls = 'always' | 'ask' | 'never'

export type ContextTool = {
  id: string
  tool: Tool
  enabled: boolean
  allow?: AllowToolCalls
}

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
 * Merges a fresh tool list into a context's tools: each surviving tool keeps its
 * `enabled`/`allow` state by name, new tools are enabled, vanished tools are dropped.
 */
export function mergeContextTools(
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

export function sameToolDefinitions(a: Array<ContextTool>, b: Array<ContextTool>): boolean {
  return JSON.stringify(a.map((ct) => ct.tool)) === JSON.stringify(b.map((ct) => ct.tool))
}
