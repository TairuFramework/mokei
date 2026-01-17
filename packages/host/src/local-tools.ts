import type { CallToolResult, InputSchema, Tool, ToolAnnotations } from '@mokei/context-protocol'
import type { GenericToolDefinition, ServerClient, ToolDefinitions } from '@mokei/context-server'

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

/**
 * Creates a stub ServerClient for use with local tools.
 * All methods throw errors explaining they're not available in local tool context.
 */
function createStubClient(): ServerClient {
  const notAvailable = (method: string) => () => {
    throw new Error(
      `${method}() is not available for local tools. ` +
        'Local tools run outside of an MCP server context and cannot access client methods.',
    )
  }

  return {
    createMessage: notAvailable('createMessage'),
    elicit: notAvailable('elicit'),
    listRoots: notAvailable('listRoots'),
    log: () => {
      // No-op for logging - tools may call this but we can safely ignore
    },
  } as ServerClient
}

/**
 * Convert a server tool definition (created with `createTool()`) to a LocalToolDefinition.
 *
 * This allows tools defined for MCP servers to be used directly as local tools
 * without needing to run a separate server process.
 *
 * Note: Tools that use `client` methods (createMessage, elicit, listRoots) will
 * throw an error when those methods are called, as they require an MCP server context.
 *
 * @example
 * ```typescript
 * import { createTool } from '@mokei/context-server'
 * import { toolToLocalTool } from '@mokei/host'
 *
 * const serverTool = createTool(
 *   'Calculate math expression',
 *   { type: 'object', properties: { expr: { type: 'string' } } } as const,
 *   (req) => ({ content: [{ type: 'text', text: String(eval(req.arguments.expr)) }] })
 * )
 *
 * const localTool = toolToLocalTool('calculate', serverTool)
 * ```
 */
export function toolToLocalTool(
  name: string,
  definition: GenericToolDefinition,
): LocalToolDefinition {
  const stubClient = createStubClient()

  return {
    name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (args: Record<string, unknown>) => {
      // Create a never-aborting signal for local execution
      const controller = new AbortController()
      return definition.handler({
        arguments: args,
        client: stubClient,
        signal: controller.signal,
      })
    },
  }
}

/**
 * Convert a record of server tool definitions to an array of LocalToolDefinitions.
 *
 * This allows an entire server config's tools to be used as local tools.
 *
 * @example
 * ```typescript
 * import { config } from '@mokei/mcp-sqlite'
 * import { toolsToLocalTools } from '@mokei/host'
 * import { Session } from '@mokei/session'
 *
 * const session = new Session({
 *   providers: { openai },
 *   localTools: toolsToLocalTools(config.tools)
 * })
 * ```
 */
export function toolsToLocalTools(tools: ToolDefinitions): Array<LocalToolDefinition> {
  return Object.entries(tools).map(([name, definition]) => toolToLocalTool(name, definition))
}
