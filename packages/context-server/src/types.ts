import type { FromSchema, Schema } from '@enkaku/schema'
import type { TransportType } from '@enkaku/transport'
import type { PromptsDefinition, ToolsDefinition } from '@mokei/context-definitions'
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

export type ServerTransport = TransportType<ClientMessage, ServerMessage>

export type HandlerContext<C extends Record<string, unknown> = Record<string, never>> = C & {
  signal: AbortSignal
}

export type PromptHandlerContext<ArgsSchema> = ArgsSchema extends Schema
  ? HandlerContext<{ args: FromSchema<ArgsSchema> }>
  : HandlerContext

export type PromptHandlerReturn = GetPromptResult | Promise<GetPromptResult>

export type PromptHandler<ArgsSchema> = (
  context: PromptHandlerContext<ArgsSchema>,
) => PromptHandlerReturn

export type ToPromptHandlers<Definition> = Definition extends PromptsDefinition
  ? { [Name in keyof Definition & string]: PromptHandler<Definition[Name]['arguments']> }
  : never

export type ResourceHandlers = {
  // TODO: accept harcoded list of Resource objects
  list: (
    context: HandlerContext<{ params: ListResourcesRequest['params'] }>,
  ) => ListResourcesResult | Promise<ListResourcesResult>
  // TODO: accept harcoded list of Resource objects
  listTemplates: (
    context: HandlerContext<{ params: ListResourceTemplatesRequest['params'] }>,
  ) => ListResourceTemplatesResult | Promise<ListResourcesResult>
  read: (
    context: HandlerContext<{ params: ReadResourceRequest['params'] }>,
  ) => ReadResourceResult | Promise<ReadResourceResult>
}

export type ToolHandlerContext<InputSchema> = InputSchema extends Schema
  ? HandlerContext<{ input: FromSchema<InputSchema> }>
  : HandlerContext

export type ToolHandlerReturn = CallToolResult | Promise<CallToolResult>

export type ToolHandler<InputSchema> = (
  context: ToolHandlerContext<InputSchema>,
) => ToolHandlerReturn

export type ToToolHandlers<Definition> = Definition extends ToolsDefinition
  ? { [Name in keyof Definition & string]: ToolHandler<Definition[Name]['input']> }
  : never
