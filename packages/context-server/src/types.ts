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
} from '@mokei/context-protocol'

import type { PromptsDefinition, ToolsDefinition } from './definitions.js'

export type ServerTransport = TransportType<ClientMessage, ServerMessage>

export type HandlerRequest<C extends Record<string, unknown> = Record<string, never>> = C & {
  signal: AbortSignal
}

export type PromptHandlerRequest<ArgumentsSchema> = ArgumentsSchema extends Schema
  ? HandlerRequest<{ arguments: FromSchema<ArgumentsSchema> }>
  : HandlerRequest

export type PromptHandlerReturn = GetPromptResult | Promise<GetPromptResult>

export type PromptHandler<ArgumentsSchema> = (
  request: PromptHandlerRequest<ArgumentsSchema>,
) => PromptHandlerReturn

export type ToPromptHandlers<Definition> = Definition extends PromptsDefinition
  ? { [Name in keyof Definition & string]: PromptHandler<Definition[Name]['arguments']> }
  : never

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

export type ToolHandlerRequest<InputSchema> = InputSchema extends Schema
  ? HandlerRequest<{ input: FromSchema<InputSchema> }>
  : HandlerRequest

export type ToolHandlerReturn = CallToolResult | Promise<CallToolResult>

export type ToolHandler<InputSchema> = (
  request: ToolHandlerRequest<InputSchema>,
) => ToolHandlerReturn

export type ToToolHandlers<Definition> = Definition extends ToolsDefinition
  ? { [Name in keyof Definition & string]: ToolHandler<Definition[Name]['input']> }
  : never
