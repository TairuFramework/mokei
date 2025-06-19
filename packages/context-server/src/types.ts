import type { FromSchema, Schema } from '@enkaku/schema'
import type { TransportType } from '@enkaku/transport'
import type {
  CallToolResult,
  ClientMessage,
  CompleteRequest,
  CompleteResult,
  GetPromptResult,
  InitializeRequest,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  LoggingLevel,
  ReadResourceRequest,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerMessage,
  InputSchema as ToolInputSchema,
} from '@mokei/context-protocol'

export type ServerTransport = TransportType<ClientMessage, ServerMessage>

export type ClientInitialize = InitializeRequest['params']

export type LogFunction = (level: LoggingLevel, data: unknown, logger?: string) => void

export type HandlerRequest<C extends Record<string, unknown> = Record<string, never>> = C & {
  log: LogFunction
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
  request: HandlerRequest<{ input: Record<string, unknown> }>,
) => ToolHandlerReturn

export type TypedToolHandler<Input> = (
  request: HandlerRequest<{ input: Input }>,
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
