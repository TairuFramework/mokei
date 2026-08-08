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
  InputResponse,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListRootsRequest,
  ListRootsResult,
  LoggingLevel,
  ProtocolVersion,
  ReadResourceRequest,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerMessage,
  InputSchema as ToolInputSchema,
  OutputSchema as ToolOutputSchema,
} from '@mokei/context-protocol'
import type { WithRequestOptions } from '@mokei/context-rpc'
import type { Schema } from '@sozai/schema'

import type { InputRequiredResult } from './mrtr.js'

export type ServerTransport = TransportType<ClientMessage, ServerMessage>

export type ClientInitialize = InitializeRequest['params']

export type LogParams = {
  level: LoggingLevel
  data: unknown
  logger?: string
}

export type LogFunction = (params: LogParams) => void

/** Thrown when a handler reaches for a client capability that this revision routes through MRTR. */
export class MRTRNotSupportedError extends Error {
  constructor(method: string, version: ProtocolVersion) {
    super(
      `${method} cannot be called on protocol version ${version}: server-initiated requests are replaced by multi round-trip requests (SEP-2322) — return \`inputRequired({ inputRequests: { <key>: { method, params } } })\` from the handler and read \`inputResponses[<key>]\` when it is re-invoked`,
    )
    this.name = 'MRTRNotSupportedError'
  }
}

export type ServerClient = {
  createMessage: (
    params: WithRequestOptions<CreateMessageRequest['params']>,
  ) => Promise<CreateMessageResult>
  elicit: (params: WithRequestOptions<ElicitRequest['params']>) => Promise<ElicitResult>
  listRoots: (params?: WithRequestOptions<ListRootsRequest['params']>) => Promise<ListRootsResult>
  log: LogFunction
}

export type ProgressEmitter = (params: {
  progress: number
  total?: number
  message?: string
}) => void

export type HandlerRequest<C extends Record<string, unknown> = Record<string, never>> = C & {
  client: ServerClient
  progress?: ProgressEmitter
  signal: AbortSignal
  /**
   * Results for the input requests this handler asked for on a previous round (MRTR, SEP-2322),
   * keyed as the handler keyed its own `inputRequests`. Absent on the first round and on
   * `2025-11-25`, which has no MRTR.
   */
  inputResponses?: Record<string, InputResponse>
  /**
   * The state this handler minted on a previous round, echoed back by the client.
   *
   * The decoded payload when the server is configured with a `requestState.verify` hook; the raw
   * string otherwise, in which case it is UNTRUSTED — it round-tripped through the client and any
   * caller can forge it. Configure the hook before letting it influence authorization.
   */
  requestState?: unknown
  /** Encodes a payload into the opaque `requestState` string to send with an `inputRequired()`. */
  mintRequestState: (payload: unknown) => string
}

export type CompleteHandler = (
  request: HandlerRequest<{ params: CompleteRequest['params'] }>,
) => CompleteResult | Promise<CompleteResult>

export type PromptHandlerReturn =
  | GetPromptResult
  | InputRequiredResult
  | Promise<GetPromptResult | InputRequiredResult>

export type GenericPromptHandler = (
  request: HandlerRequest<{ input: unknown }>,
) => PromptHandlerReturn

export type TypedPromptHandler<Arguments> = (
  request: HandlerRequest<{ input: Arguments }>,
) => PromptHandlerReturn

export type GenericPromptDefinition = {
  description: string
  argumentsSchema?: Schema
  handler: GenericPromptHandler
}

/**
 * What `createPrompt` returns: a runtime `GenericPromptDefinition` carrying a phantom witness
 * of the argument type its `argumentsSchema` describes. See {@link ToolDefinition}.
 */
export type PromptDefinition<Arguments = Record<string, unknown>> = GenericPromptDefinition & {
  /** @internal Phantom type witness. Never present at runtime; do not read it. */
  readonly _arguments?: Arguments
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
) => ReadResourceResult | InputRequiredResult | Promise<ReadResourceResult | InputRequiredResult>

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

export type ToolHandlerReturn =
  | CallToolResult
  | InputRequiredResult
  | Promise<CallToolResult | InputRequiredResult>

export type StructuredToolHandlerReturn<Output> = Omit<CallToolResult, 'content'> & {
  content?: CallToolResult['content']
  structuredContent: Output
}

export type GenericToolHandler = (
  request: HandlerRequest<{ input: Record<string, unknown> }>,
) => ToolHandlerReturn

export type TypedToolHandler<Arguments, Output = unknown> = (
  request: HandlerRequest<{ input: Arguments }>,
) => [unknown] extends [Output]
  ? ToolHandlerReturn
  : StructuredToolHandlerReturn<Output> | Promise<StructuredToolHandlerReturn<Output>>

export type GenericToolDefinition = {
  description: string
  inputSchema: ToolInputSchema
  outputSchema?: ToolOutputSchema
  handler: GenericToolHandler
}

/**
 * What `createTool` returns: a runtime `GenericToolDefinition` carrying a phantom witness of
 * the argument type its `inputSchema` describes.
 *
 * The witness is type-level only — never present at runtime. It exists so
 * {@link ExtractToolTypes} can recover a tool's argument type by reading one optional
 * property. The alternative — structurally matching the whole definition against a typed
 * one — forces TypeScript to compare `handler` types, which carry the large `CallToolResult`
 * union, and that exceeds the instantiation depth (TS2589/TS2590).
 */
export type ToolDefinition<Arguments = Record<string, unknown>> = GenericToolDefinition & {
  /** @internal Phantom type witness. Never present at runtime; do not read it. */
  readonly _arguments?: Arguments
}

export type ToolDefinitions = Record<string, GenericToolDefinition>

/**
 * Extract TypeScript types from tool definitions for type-safe client usage.
 *
 * @example
 * ```typescript
 * const tools = {
 *   myTool: createTool({
 *     description: 'Description',
 *     inputSchema: { type: 'object', properties: { foo: { type: 'string' } } } as const,
 *     handler,
 *   })
 * } satisfies ToolDefinitions
 *
 * type MyTools = ExtractToolTypes<typeof tools>
 * // Result: { myTool: { foo: string } }
 * ```
 */
export type ExtractToolTypes<T extends ToolDefinitions> = {
  [K in keyof T]: ExtractArguments<T[K]>
}

/**
 * Read a definition's phantom argument witness, falling back to an open record for a
 * definition that carries none (a hand-written `GenericToolDefinition`, or a tool whose
 * schema TypeScript could not narrow).
 *
 * Reading one optional property is deliberate: matching the definition structurally would
 * drag its `handler` — and the `CallToolResult` union inside it — into the comparison.
 */
type ExtractArguments<Definition> = Definition extends { readonly _arguments?: infer Arguments }
  ? unknown extends Arguments
    ? Record<string, unknown>
    : Arguments
  : Record<string, unknown>

/**
 * Extract TypeScript types from prompt definitions for type-safe client usage.
 *
 * @example
 * ```typescript
 * const prompts = {
 *   myPrompt: createPrompt({
 *     description: 'Description',
 *     argumentsSchema: { type: 'object', properties: { name: { type: 'string' } } } as const,
 *     handler,
 *   })
 * } satisfies PromptDefinitions
 *
 * type MyPrompts = ExtractPromptTypes<typeof prompts>
 * // Result: { myPrompt: { name: string } }
 * ```
 */
export type ExtractPromptTypes<T extends PromptDefinitions> = {
  [K in keyof T]: ExtractArguments<T[K]>
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
 * const client = new ContextClient<MyServerTypes>({ protocolVersion: '2025-11-25', transport })
 * ```
 */
export type ExtractServerTypes<T extends { tools?: ToolDefinitions; prompts?: PromptDefinitions }> =
  {
    Tools: T['tools'] extends ToolDefinitions ? ExtractToolTypes<T['tools']> : Record<string, never>
    Prompts: T['prompts'] extends PromptDefinitions
      ? ExtractPromptTypes<T['prompts']>
      : Record<string, never>
  }
