import type { CallToolResult, InputSchema, Tool, ToolAnnotations } from '@mokei/context-protocol'

/**
 * Execute function for a local tool.
 * Receives parsed arguments and returns a CallToolResult.
 */
export type LocalToolExecute<TArgs = Record<string, unknown>> = (
  args: TArgs,
) => CallToolResult | Promise<CallToolResult>

/**
 * Definition for a local tool that can be registered directly
 * without setting up a full MCP server.
 *
 * @example
 * ```typescript
 * const calculator: LocalToolDefinition = {
 *   name: 'calculate',
 *   description: 'Evaluate a math expression',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       expression: { type: 'string', description: 'Math expression to evaluate' }
 *     },
 *     required: ['expression']
 *   },
 *   execute: async ({ expression }) => {
 *     const result = eval(expression)
 *     return { content: [{ type: 'text', text: String(result) }] }
 *   }
 * }
 * ```
 */
export type LocalToolDefinition<TArgs = Record<string, unknown>> = {
  /** Unique name for the tool */
  name: string
  /** Human-readable description of what the tool does */
  description?: string
  /** JSON Schema defining the expected input parameters */
  inputSchema: InputSchema
  /** Optional annotations providing hints about tool behavior */
  annotations?: ToolAnnotations
  /** Function to execute when the tool is called */
  execute: LocalToolExecute<TArgs>
}

/**
 * Internal representation of a registered local tool.
 */
export type LocalTool = {
  /** The MCP-compatible tool definition */
  tool: Tool
  /** The execute function */
  execute: LocalToolExecute
}

/**
 * The namespace prefix used for local tools.
 * Local tools are identified as `local:toolName`.
 */
export const LOCAL_TOOL_NAMESPACE = 'local'

/**
 * Create a Tool definition from a LocalToolDefinition.
 */
export function createToolFromDefinition(definition: LocalToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
  }
}

/**
 * Check if a namespaced tool ID refers to a local tool.
 */
export function isLocalToolID(id: string): boolean {
  return id.startsWith(`${LOCAL_TOOL_NAMESPACE}:`)
}

/**
 * Get the tool name from a local tool ID.
 * @throws If the ID is not a local tool ID
 */
export function getLocalToolName(id: string): string {
  if (!isLocalToolID(id)) {
    throw new Error(`Not a local tool ID: ${id}`)
  }
  return id.slice(LOCAL_TOOL_NAMESPACE.length + 1)
}

/**
 * Create a local tool ID from a tool name.
 */
export function createLocalToolID(name: string): string {
  return `${LOCAL_TOOL_NAMESPACE}:${name}`
}
