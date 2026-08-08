import type { CallToolResult, InputSchema, Tool, ToolAnnotations } from '@mokei/context-protocol'
import type { GenericToolDefinition, ServerClient, ToolDefinitions } from '@mokei/context-server'
import { isInputRequiredResult } from '@mokei/context-server'

/**
 * Request handed to a local tool's execute function: the validated `input` — the thing the
 * tool's `inputSchema` describes — plus the signal that aborts if the caller cancels.
 *
 * Mirrors the `HandlerRequest` a `createTool` handler receives, so a tool is written the
 * same way whether it runs locally or behind an MCP server. The wire calls this field
 * `arguments`; handlers see `input`, which (unlike `arguments`) can be destructured — the
 * latter is a reserved binding name in strict mode.
 */
export type LocalToolRequest<TArgs = Record<string, unknown>> = {
  input: TArgs
  signal?: AbortSignal
}

/**
 * Execute function for a local tool.
 * Receives the validated input and returns a CallToolResult.
 */
export type LocalToolExecute<TArgs = Record<string, unknown>> = (
  request: LocalToolRequest<TArgs>,
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
 *   execute: async ({ input: { expression } }) => {
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

export type ToolToLocalToolParams = {
  name: string
  definition: GenericToolDefinition
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
 * const serverTool = createTool({
 *   description: 'Calculate math expression',
 *   inputSchema: { type: 'object', properties: { expr: { type: 'string' } } } as const,
 *   handler: (req) => ({ content: [{ type: 'text', text: String(eval(req.input.expr)) }] }),
 * })
 *
 * const localTool = toolToLocalTool({ name: 'calculate', definition: serverTool })
 * ```
 */
export function toolToLocalTool(params: ToolToLocalToolParams): LocalToolDefinition {
  const { name, definition } = params
  const stubClient = createStubClient()

  return {
    name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (request: LocalToolRequest) => {
      const result = await definition.handler({
        input: request.input,
        client: stubClient,
        // Forward the caller's cancellation signal; fall back to a never-aborting
        // one when invoked outside callLocalTool's cancellation plumbing.
        signal: request.signal ?? new AbortController().signal,
        // Local tools run outside any MCP request/response cycle, so there is no wire to
        // round-trip a `requestState` over — but `mintRequestState` is a pure encoder a
        // handler may still call while building an `inputRequired()` result, so it gets the
        // same default `ContextServer` falls back to rather than a throwing stub.
        mintRequestState: (payload: unknown) => JSON.stringify(payload),
      })
      // A handler suspends (MRTR, SEP-2322) by returning rather than awaiting, so there is no
      // exception to catch here the way `createStubClient` catches a direct `client` call. Local
      // execution has no wire and no retry loop to resume it on, so a suspension is refused the
      // same way an unreachable `client` method is.
      if (isInputRequiredResult(result)) {
        throw new Error(
          'This tool suspended on input (MRTR, SEP-2322), which is not available for local tools. ' +
            'Local tools run outside of an MCP server context and cannot round-trip a client request.',
        )
      }
      return result
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
  return Object.entries(tools).map(([name, definition]) => toolToLocalTool({ name, definition }))
}
