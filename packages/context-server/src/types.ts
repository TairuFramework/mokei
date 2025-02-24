import type { FromSchema, Schema } from '@enkaku/schema'
import type { TransportType } from '@enkaku/transport'
import type {
  CallToolResult,
  ClientMessage,
  GetPromptResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListResourcesRequest,
  ListResourcesResult,
  ReadResourceRequest,
  ReadResourceResult,
  ServerMessage,
  InputSchema as ToolInputSchema,
} from '@mokei/context-protocol'

export type ServerTransport = TransportType<ClientMessage, ServerMessage>

export type HandlerRequest<C extends Record<string, unknown> = Record<string, never>> = C & {
  signal: AbortSignal
}

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

export type ResourceHandlers = {
  // TODO: accept harcoded list of Resource objects
  list: (
    request: HandlerRequest<{ params: ListResourcesRequest['params'] }>,
  ) => ListResourcesResult | Promise<ListResourcesResult>
  // TODO: accept harcoded list of Resource objects
  listTemplates: (
    request: HandlerRequest<{ params: ListResourceTemplatesRequest['params'] }>,
  ) => ListResourceTemplatesResult | Promise<ListResourcesResult>
  read: (
    request: HandlerRequest<{ params: ReadResourceRequest['params'] }>,
  ) => ReadResourceResult | Promise<ReadResourceResult>
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
