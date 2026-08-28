import type { TransportType } from '@enkaku/transport'
import type {
  ClientMessage,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  Implementation,
  LoggingLevel,
  Metadata,
  ProtocolVersion,
  Root,
  ServerMessage,
} from '@mokei/context-protocol'
import type { RequestOptions } from '@mokei/context-rpc'
import { splitRequestOptions } from '@mokei/context-rpc'

export type ClientTransport = TransportType<ServerMessage, ClientMessage>

/**
 * Pagination and transport options accepted by the paginated list methods, alongside the
 * request's own params.
 *
 * `signal` aborts the walk, cancelling the request in flight; `timeout` applies to each
 * page request, not to the walk as a whole.
 */
export type ListOptions = RequestOptions & {
  /** Overrides `ClientParams.listMaxPages` for this call. */
  maxPages?: number
}

/** Params of a paginated list method: its wire params plus {@link ListOptions}. */
export type ListParams<Params> = Params & ListOptions

/**
 * Splits a list method's parameters into the params sent on the wire and the options kept
 * local to this process.
 *
 * The counterpart to `splitRequestOptions` for the paginated methods, which carry one
 * local-only option it does not know about: `maxPages`. Any paginated method must split
 * here rather than there, or the cap is serialized into the request sent to the peer.
 */
export function splitListOptions<Params>(
  params: ListParams<Params>,
): [Params, ListOptions & RequestOptions] {
  const { maxPages, ...rest } = params as ListParams<Record<string, unknown>>
  const [wireParams, options] = splitRequestOptions(rest)
  return [wireParams as Params, { ...options, maxPages }]
}

/**
 * A server-initiated request handed to a client handler: the request's params, plus the
 * signal that aborts if the server cancels it.
 *
 * Mirrors `HandlerRequest` on the server side, so a handler is one object either way.
 */
export type ClientHandlerRequest<Params = Record<string, never>> = {
  params: Params
  signal: AbortSignal
}

export type ElicitHandler = (
  request: ClientHandlerRequest<ElicitRequest['params']>,
) => ElicitResult | Promise<ElicitResult>

// Sampling (createMessage) and roots (listRoots) are deprecated on 2026-07-28 (SEP-2577),
// current on 2025-11-25. These handler surfaces are shared across both revisions and remain
// fully supported through the deprecation window; the tag is deliberately omitted so current
// 2025-11-25 consumers are not warned.
export type CreateMessageHandler = (
  request: ClientHandlerRequest<CreateMessageRequest['params']>,
) => CreateMessageResult | Promise<CreateMessageResult>

export type ListRootsHandler = (
  request: Omit<ClientHandlerRequest, 'params'>,
) => Array<Root> | Promise<Array<Root>>

/** Parameters of {@link ContextClient.subscribeResource}/`unsubscribeResource`. */
export type ResourceSubscriptionParams = {
  /** The resource URI to subscribe to / unsubscribe from. */
  uri: string
  /** Aborts the mutation before its listen filter is acknowledged. */
  signal?: AbortSignal
  /** Bounds the wait for the new filter's acknowledgement (ms). */
  timeout?: number
}

export type ContextTypes = {
  Prompts?: Record<string, Record<string, unknown> | never>
  Tools?: Record<string, Record<string, unknown>>
}

export type UnknownContextTypes = {
  Prompts: Record<string, Record<string, unknown>>
  Tools: Record<string, Record<string, unknown>>
}

/**
 * Params of a named call, as a union of one member per name — so `arguments` is the type of
 * *that* name's arguments.
 *
 * The obvious shape, `{ name: keyof M & string; arguments: M[keyof M] }`, is wrong: it takes
 * the union of every entry's arguments and correlates it with nothing, so calling tool `a`
 * with tool `b`'s arguments type-checks. Distributing over the keys keeps the two tied.
 */
type NamedParams<M> = {
  [K in keyof M & string]: {
    name: K
    arguments: M[K] extends undefined ? never : M[K]
    _meta?: Metadata
  }
}[keyof M & string]

export type PromptParams<T extends ContextTypes> = NamedParams<T['Prompts']>

export type ToolParams<T extends ContextTypes> = NamedParams<T['Tools']>

export type ClientParams = {
  /** Revision to speak. `'auto'` probes the server, then caches the result. */
  protocolVersion: ProtocolVersion | 'auto'
  clientInfo?: Implementation
  createMessage?: CreateMessageHandler
  elicit?: ElicitHandler
  listMaxPages?: number
  listRoots?: Array<Root> | ListRootsHandler
  logLevel?: LoggingLevel
  /**
   * Multi round-trip request behavior (MRTR, SEP-2322). `autoFulfill` (default `true`) dispatches
   * a server's embedded input requests to this client's own `createMessage`/`elicit`/`listRoots`
   * handlers and retries, so callers of `callTool`/`getPrompt`/`readResource` receive the same
   * result type they do on `2025-11-25`. `maxRounds` (default 10) caps a single call's rounds.
   */
  inputRequired?: { autoFulfill?: boolean; maxRounds?: number }
  /**
   * Server-initiated request handlers (`sampling/createMessage`, `elicitation/create`,
   * `roots/list` on `2025-11-25`) allowed to run at once (default 100). Symmetric with
   * `@mokei/context-server`'s `ServerParams.maxConcurrentRequests`.
   */
  maxConcurrentRequests?: number
  /** Server-initiated requests allowed to wait for a slot before further ones are refused (default 1000). */
  maxQueuedRequests?: number
  /**
   * Called for an inbound frame that could neither be validated nor routed to anything —
   * an invalid notification, or a malformed frame naming an id nobody is waiting on — and
   * for server-initiated request handlers that failed. Without it such frames vanish silently.
   */
  onError?: (error: Error) => void
  /**
   * Default timeout for every request after setup. Unset means unbounded — `tools/call` can
   * legitimately run for minutes, and `@mokei/session` already bounds tool calls itself.
   * `setupTimeout` covers connection setup regardless of this value.
   */
  requestTimeout?: number
  /**
   * Bounds every setup-time round trip: the `2025-11-25` handshake, the `'auto'` probe, and the
   * `server/discover` a revision without a handshake sends in their place. It is the only thing
   * that fails a connection to a server that is spawned but never answers.
   */
  setupTimeout?: number
  /** @deprecated Renamed to `setupTimeout`. */
  initializeTimeout?: number
  transport: ClientTransport
}
