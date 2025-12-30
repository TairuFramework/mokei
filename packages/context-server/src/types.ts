import type { FromSchema, Schema } from '@enkaku/schema'
import type { TransportType } from '@enkaku/transport'
import type {
  CallToolResult,
  ClientMessage,
  CompleteRequest,
  CompleteResult,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  GetPromptResult,
  InitializeRequest,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListRootsRequest,
  ListRootsResult,
  LoggingLevel,
  ReadResourceRequest,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerMessage,
  InputSchema as ToolInputSchema,
} from '@mokei/context-protocol'
import type { SentRequest } from '@mokei/context-rpc'

export type ServerTransport = TransportType<ClientMessage, ServerMessage>

export type ClientInitialize = InitializeRequest['params']

export type LogFunction = (level: LoggingLevel, data: unknown, logger?: string) => void

export type ServerClient = {
  createMessage: (params: CreateMessageRequest['params']) => SentRequest<CreateMessageResult>
  elicit: (params: ElicitRequest['params']) => SentRequest<ElicitResult>
  listRoots: (params?: ListRootsRequest['params']) => SentRequest<ListRootsResult>
  log: LogFunction
}

export type HandlerRequest<C extends Record<string, unknown> = Record<string, never>> = C & {
  client: ServerClient
  signal: AbortSignal
}

export type CompleteHandler = (
  request: HandlerRequest<{ params: CompleteRequest['params'] }>,
) => CompleteResult | Promise<CompleteResult>

export type PromptHandlerReturn = GetPromptResult | Promise<GetPromptResult>

export type GenericPromptHandler = (
  request: HandlerRequest<{ arguments: unknown }>,
) => PromptHandlerReturn

export type TypedPromptHandler<Arguments> = (
  request: HandlerRequest<{ arguments: Arguments }>,
) => PromptHandlerReturn

export type GenericPromptDefinition = {
  description: string
  argumentsSchema?: Schema
  handler: GenericPromptHandler
}

export type TypedPromptDefinition<ArgumentsSchema extends Schema> = {
  description: string
  argumentsSchema: Schema
  handler: TypedPromptHandler<FromSchema<ArgumentsSchema>>
}

export type PromptDefinitions = Record<string, GenericPromptDefinition>

export type ListResourcesHandler = (
  request: HandlerRequest<{ params: ListResourcesRequest['params'] }>,
) => ListResourcesResult | Promise<ListResourcesResult>

export type ListResourceTemplatesHandler = (
  request: HandlerRequest<{ params: ListResourceTemplatesRequest['params'] }>,
) => ListResourceTemplatesResult | Promise<ListResourceTemplatesResult>

export type ReadResourceHandler = (
  request: HandlerRequest<{ params: ReadResourceRequest['params'] }>,
) => ReadResourceResult | Promise<ReadResourceResult>

export type ResourceDefinitions = {
  list?: ListResourcesHandler | Array<Resource>
  listTemplates?: ListResourceTemplatesHandler | Array<ResourceTemplate>
  read: ReadResourceHandler
}

export type ResourceHandlers = {
  list: ListResourcesHandler
  listTemplates: ListResourceTemplatesHandler
  read: ReadResourceHandler
}

export type ToolHandlerReturn = CallToolResult | Promise<CallToolResult>

export type GenericToolHandler = (
  request: HandlerRequest<{ arguments: Record<string, unknown> }>,
) => ToolHandlerReturn

export type TypedToolHandler<Arguments> = (
  request: HandlerRequest<{ arguments: Arguments }>,
) => ToolHandlerReturn

export type GenericToolDefinition = {
  description: string
  inputSchema: ToolInputSchema
  handler: GenericToolHandler
}

export type TypedToolDefinition<InputSchema extends Schema & ToolInputSchema> = {
  description: string
  inputSchema: InputSchema
  handler: TypedToolHandler<FromSchema<InputSchema>>
}

export type ToolDefinitions = Record<string, GenericToolDefinition>

/**
 * Extract TypeScript types from tool definitions for type-safe client usage.
 *
 * @example
 * ```typescript
 * const tools = {
 *   myTool: createTool('Description', { type: 'object', properties: { foo: { type: 'string' } } } as const, handler)
 * } satisfies ToolDefinitions
 *
 * type MyTools = ExtractToolTypes<typeof tools>
 * // Result: { myTool: { foo: string } }
 * ```
 */
export type ExtractToolTypes<T extends ToolDefinitions> = {
  [K in keyof T]: T[K] extends TypedToolDefinition<infer S>
    ? FromSchema<S>
    : T[K] extends GenericToolDefinition
      ? Record<string, unknown>
      : never
}

/**
 * Extract TypeScript types from prompt definitions for type-safe client usage.
 *
 * @example
 * ```typescript
 * const prompts = {
 *   myPrompt: createPrompt('Description', { type: 'object', properties: { name: { type: 'string' } } } as const, handler)
 * } satisfies PromptDefinitions
 *
 * type MyPrompts = ExtractPromptTypes<typeof prompts>
 * // Result: { myPrompt: { name: string } }
 * ```
 */
export type ExtractPromptTypes<T extends PromptDefinitions> = {
  [K in keyof T]: T[K] extends TypedPromptDefinition<infer S>
    ? FromSchema<S>
    : T[K] extends GenericPromptDefinition
      ? Record<string, unknown>
      : never
}

/**
 * Extract complete context types from a server configuration for type-safe client usage.
 *
 * @example
 * ```typescript
 * const config = {
 *   name: 'my-server',
 *   version: '1.0.0',
 *   tools: { ... },
 *   prompts: { ... }
 * } satisfies ServerConfig
 *
 * type MyServerTypes = ExtractServerTypes<typeof config>
 * const client = new ContextClient<MyServerTypes>({ transport })
 * ```
 */
export type ExtractServerTypes<T extends { tools?: ToolDefinitions; prompts?: PromptDefinitions }> =
  {
    Tools: T['tools'] extends ToolDefinitions ? ExtractToolTypes<T['tools']> : Record<string, never>
    Prompts: T['prompts'] extends PromptDefinitions
      ? ExtractPromptTypes<T['prompts']>
      : Record<string, never>
  }
