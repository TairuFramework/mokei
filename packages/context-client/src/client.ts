import type {
  CallToolRequest,
  CallToolResult,
  ClientCapabilities,
  ClientMessage,
  ClientNotifications,
  ClientRequests,
  ClientResult,
  CompleteRequest,
  CompleteResult,
  CreateMessageRequest,
  CreateMessageResult,
  DiscoverResult,
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  GetPromptResult,
  Implementation,
  InitializeRequest,
  InitializeResult,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListToolsRequest,
  ListToolsResult,
  Log,
  LoggingLevel,
  Metadata,
  ProgressNotification,
  ProtocolDefinition,
  ProtocolVersion,
  ReadResourceRequest,
  ReadResourceResult,
  Result,
  Root,
  ServerCapabilities,
  ServerMessage,
  ServerNotification,
  ServerRequest,
  SetLevelRequest,
} from '@mokei/context-protocol'
import {
  discoverResult,
  type ErrorResponse,
  INVALID_REQUEST,
  inferSchemaDraft,
  isSupportedProtocolVersion,
  METHOD_NOT_FOUND,
  PROTOCOL_VERSIONS,
  PROTOCOLS,
  serverMessage,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '@mokei/context-protocol'
import {
  ContextRPC,
  type RequestOptions,
  RequestTimeoutError,
  RPCError,
  splitRequestOptions,
  type WithRequestOptions,
} from '@mokei/context-rpc'
import { lazy } from '@sozai/async'
import { createValidator, type Schema, type Validator } from '@sozai/schema'

import { currentTraceMeta } from './trace.js'
import type { ClientTransport } from './types.js'

/**
 * Inbound wire validators, one per revision. Which one applies is decided per connection by
 * `#validateServerMessage` once the revision is resolved — a `2026-07-28` server cannot legally
 * send `ping`, `sampling/createMessage`, `elicitation/create` or
 * `notifications/elicitation/complete`, and the wire parser is where a peer producing something
 * its own revision forbids has to be refused.
 *
 * `2025-11-25`'s entry is built from the package's unqualified `serverMessage`, which is that
 * revision's own union and still lives outside `versions/`. Moving it in is a wider change than
 * this validator wiring — the package exports it as the unqualified `ServerMessage` /
 * `ServerRequest` / `ServerResult` types that both peers are typed against — so it stays put and
 * is referenced here by the revision it belongs to.
 */
const SERVER_MESSAGE_VALIDATORS: Record<ProtocolVersion, Validator<ServerMessage>> = {
  '2025-11-25': createValidator<Schema, ServerMessage>(PROTOCOLS['2025-11-25'].serverMessage),
  '2026-07-28': createValidator<Schema, ServerMessage>(PROTOCOLS['2026-07-28'].serverMessage),
}

/**
 * The cross-revision union, used only while `protocolVersion: 'auto'` is still unresolved: with
 * no revision there is no per-revision union to apply. Unreachable in practice — the read loop
 * only starts once `#setup()` has settled `#protocol` — but the fallback keeps the validator
 * total rather than making the read loop depend on that ordering.
 */
const validateAnyServerMessage = createValidator(serverMessage)

/**
 * Validates a `server/discover` result against `2026-07-28`'s own schema, replacing the cast
 * `#sendDiscover()` used to return through. `discoverResult` is not a member of `2025-11-25`'s
 * `serverResult` — `server/discover` does not exist on that revision, and `#sendDiscover()` is
 * only ever called once a handshake-less revision is known or being probed — so one validator
 * covers every caller.
 */
const validateDiscoverResult = createValidator(discoverResult)

export const DEFAULT_CLIENT_INFO: Implementation = {
  name: 'Mokei',
  version: '0.4.0',
}

// '2025-11-25' rather than the latest protocol version: it is the only supported revision
// that has an `initialize` handshake at all. '2026-07-28' has no `initialize` request
// (`requiresHandshake: false`), so declaring it here would describe a handshake no revision
// can legitimately send. `#initialize()` always overrides this with the resolved protocol's
// own version before sending, so this default is never sent as-is.
export const DEFAULT_INITIALIZE_PARAMS: InitializeRequest['params'] = {
  capabilities: {},
  clientInfo: DEFAULT_CLIENT_INFO,
  protocolVersion: '2025-11-25',
}

export const DEFAULT_INITIALIZE_TIMEOUT = 30_000

/** Default cap on pages fetched by a single list walk. */
export const DEFAULT_LIST_MAX_PAGES = 100

/** Max notifications buffered once a reader is attached; oldest dropped past this. */
const NOTIFICATION_BUFFER_CAP = 256

/**
 * The revision an `'auto'` probe speaks before it knows what the server speaks: the newest
 * registered revision that both needs no handshake and has `server/discover` to send.
 *
 * Derived from the registry rather than named, so a future handshake-less revision is probed
 * with its own envelope instead of an older one's — `PROTOCOL_VERSIONS` is newest-first.
 *
 * The stamp this produces is a *guess*, and deliberately so: a probe is by definition sent
 * before the revision is agreed, and a server that speaks something else answers with an error,
 * which is precisely the signal `#probe()` falls back on. This is the one place in this file
 * where stamping a revision the peer may not speak is correct — every other outgoing frame
 * stamps the revision that was actually resolved.
 *
 * `null` when no registered revision qualifies, rather than a throw. This is module-level, so
 * throwing here would crash the *import* of this package for every consumer — including one
 * pinned to a handshake revision that never probes — the moment the registry stopped carrying a
 * handshake-less revision. `#probe()` treats `null` as "nothing to probe with" and falls through
 * to the handshake, which is the same place a refused probe lands and is always a live option:
 * `'auto'` degrades to the behaviour of a pinned older client instead of taking the package down.
 */
const PROBE_PROTOCOL: ProtocolDefinition | null = (() => {
  const version = PROTOCOL_VERSIONS.find((candidate) => {
    const protocol = PROTOCOLS[candidate]
    return !protocol.requiresHandshake && protocol.clientMethods.has('server/discover')
  })
  return version == null ? null : PROTOCOLS[version]
})()

/** Notifications that invalidate whatever the client learned from `server/discover`. */
const LIST_CHANGED_NOTIFICATIONS: ReadonlySet<string> = new Set([
  'notifications/prompts/list_changed',
  'notifications/resources/list_changed',
  'notifications/tools/list_changed',
])

export class UnsupportedProtocolVersionError extends Error {
  /**
   * `expected` is only known when this is raised against a server's handshake response (the
   * negotiated version has to match the one the client asked for). A rejected config-time pin
   * (`ClientParams.protocolVersion`) has no single "expected" value to name, so it's omitted
   * there and the message drops the clause instead of naming an arbitrary revision.
   */
  constructor(received: string, expected?: ProtocolVersion) {
    super(
      expected == null
        ? `Unsupported protocolVersion "${received}"`
        : `Server responded with unsupported protocolVersion "${received}"; expected "${expected}"`,
    )
    this.name = 'UnsupportedProtocolVersionError'
  }
}

export class CapabilityNotDeclaredError extends Error {
  constructor(capability: string) {
    super(`Server did not declare the "${capability}" capability`)
    this.name = 'CapabilityNotDeclaredError'
  }
}

/**
 * Thrown when a method is absent from a protocol revision's `clientMethods` — derived from that
 * table, not a version literal, so this fires exactly when the method itself is gone (as
 * opposed to, say, a rejected parameter value).
 *
 * `request()` throws it for any method at all, which is what covers a caller reaching past the
 * typed wrappers. `setLoggingLevel()` throws it earlier, before its capability check, and passes
 * `hint` to say where the log level went on `2026-07-28`.
 */
export class MethodNotInRevisionError extends Error {
  constructor(method: string, version: ProtocolVersion, hint?: string) {
    super(
      `${method} does not exist in protocol version ${version}${hint == null ? '' : `: ${hint}`}`,
    )
    this.name = 'MethodNotInRevisionError'
  }
}

/**
 * Thrown when a client is configured with a `createMessage`/`elicit`/`listRoots` handler on a
 * protocol revision whose `serverMethods` carries no way to invoke it — the client-side mirror
 * of `@mokei/context-server`'s `MRTRNotSupportedError`. `2026-07-28` has no server-initiated
 * requests: `sampling/createMessage`, `elicitation/create` and `roots/list` are replaced by
 * multi round-trip requests (MRTR, SEP-2322), which mokei does not implement yet.
 */
export class MRTRNotSupportedError extends Error {
  constructor(handler: string, version: ProtocolVersion) {
    super(
      `The "${handler}" handler is not supported on protocol version ${version}: sampling, elicitation and roots are replaced by multi round-trip requests (MRTR, SEP-2322), which mokei does not implement yet`,
    )
    this.name = 'MRTRNotSupportedError'
  }
}

/** Thrown when a server returns an `input_required` result: MRTR (SEP-2322) is not implemented yet. */
export class InputRequiredNotSupportedError extends Error {
  constructor() {
    super(
      'The server returned an "input_required" result: multi round-trip requests (MRTR, SEP-2322) are not implemented yet',
    )
    this.name = 'InputRequiredNotSupportedError'
  }
}

/** Thrown when a paginated list walk fetches more pages than its cap allows. */
export class ListMaxPagesError extends Error {
  /** The list method that exceeded the cap, e.g. `tools/list`. */
  method: string
  /** Number of pages fetched before giving up. */
  pages: number
  /** Cursor of the page that would have been fetched next. */
  cursor: string
  /** Items collected across the pages that were fetched. */
  results: Array<unknown>

  constructor(method: string, pages: number, cursor: string, results: Array<unknown>) {
    super(`Listing ${method} exceeded the maximum of ${pages} pages`)
    this.name = 'ListMaxPagesError'
    this.method = method
    this.pages = pages
    this.cursor = cursor
    this.results = results
  }
}

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

/** A validation issue, matching the shape `createTool` produces for input errors. */
export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<PropertyKey>
}

/** Thrown when a tool result's structuredContent violates the tool's advertised outputSchema. */
export class StructuredContentValidationError extends Error {
  toolName: string
  issues: Array<ValidationIssue>

  constructor(toolName: string, issues: Array<ValidationIssue>) {
    super(`Invalid structuredContent returned by tool ${toolName}`)
    this.name = 'StructuredContentValidationError'
    this.toolName = toolName
    this.issues = issues
  }
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

export type CreateMessageHandler = (
  request: ClientHandlerRequest<CreateMessageRequest['params']>,
) => CreateMessageResult | Promise<CreateMessageResult>

export type ListRootsHandler = (
  request: Omit<ClientHandlerRequest, 'params'>,
) => Array<Root> | Promise<Array<Root>>

export type ClientEvents = {
  closed: { error?: Error }
  initialized: InitializeResult
  log: Log
}

type HandleNotification = ProgressNotification | ServerNotification

type ClientTypes = {
  Events: ClientEvents
  MessageIn: ServerMessage
  MessageOut: ClientMessage
  HandleNotification: HandleNotification
  HandleRequest: ServerRequest
  SendNotifications: ClientNotifications
  SendRequests: ClientRequests
  SendResult: ClientResult
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

type PagedResult = { nextCursor?: string } & Record<string, unknown>

export class ContextClient<
  T extends ContextTypes = UnknownContextTypes,
> extends ContextRPC<ClientTypes> {
  #capabilities: ClientCapabilities
  #clientInfo: Implementation
  #createMessage?: CreateMessageHandler
  #discovered: { result: DiscoverResult; expiresAt: number } | null = null
  #discovering: Promise<DiscoverResult> | null = null
  #elicit?: ElicitHandler
  #initialized: PromiseLike<InitializeResult>
  #listMaxPages: number
  #listRoots?: Array<Root> | ListRootsHandler
  #logLevel?: LoggingLevel
  #notificationBuffer: Array<HandleNotification> = []
  #notificationPull: (() => void) | null = null
  #hasNotificationReader = false
  #notifications: ReadableStream<HandleNotification>
  // The one outstanding low-level read shared by `#sendDiscover()` and `#initialize()` via
  // `#readUntil()`. See `#readUntil()`'s own comment for why this must not become two
  // independent `reader.read()` calls.
  #pendingSetupRead: Promise<ReadableStreamReadResult<ServerMessage>> | null = null
  #protocol: ProtocolDefinition | null
  #reading = false
  #ready: PromiseLike<void>
  #serverCapabilities: InitializeResult['capabilities'] = {}
  // Session-lifetime snapshot of the discovered server capabilities, used only for gating on a
  // revision without a handshake (`requiresHandshake: false`). Populated once by
  // `#requireServerCapabilityAsync` and never re-fetched afterward: without a handshake, a live
  // connection's *declared* capabilities cannot change except via a `*_list_changed`
  // notification — which `_handleNotification` acts on, so the exception is enforced rather
  // than merely documented. That makes a connection-lifetime snapshot sound for gating even
  // though it ignores `discover()`'s own `ttlMs`. Distinct from `#discovered`, which still
  // honors `ttlMs` for callers who explicitly want a fresh answer from `discover()` itself. Do
  // not merge these two caches back together — that reintroduces the bug this split fixes.
  // Whatever clears one must clear the other, so neither outlives the connection state that
  // produced it — see `#resetDiscovery()`.
  #serverCapabilitySnapshot: ServerCapabilities | null = null
  #setupTimeout: number
  // Messages read during setup (probe and/or handshake) that didn't match the waiter that read
  // them — buffered here rather than dropped, so a later waiter with a different predicate
  // (e.g. the handshake reading past a message the probe already consumed) can still claim
  // them. See `#readUntil()`. Anything still here once setup finishes (e.g. a notification that
  // arrived mid-setup and matched no setup-phase waiter) is drained by the overridden `_read()`
  // as the read loop's first reads, so nothing buffered here is retained past that point.
  #setupBuffer: Array<ServerMessage> = []
  #toolOutputSchemas = new Map<string, Validator<unknown>>()

  constructor(params: ClientParams) {
    // Indirected through a method so the validator tracks the resolved revision rather than
    // being frozen at construction, which `protocolVersion: 'auto'` requires.
    super({
      defaultRequestTimeout: params.requestTimeout,
      validateMessageIn: (message) => this.#validateServerMessage(message),
      transport: params.transport,
      maxConcurrentRequests: params.maxConcurrentRequests,
      maxQueuedRequests: params.maxQueuedRequests,
      onError: params.onError,
    })

    this.#createMessage = params.createMessage
    this.#elicit = params.elicit
    this.#listRoots = params.listRoots

    // `isSupportedProtocolVersion` before indexing: `PROTOCOLS[unknown]` is `undefined`, which
    // is nullish, so an unvalidated string used to skip the handler check below and reach
    // `#setup()` as though `'auto'` had been asked for — silently probing instead of failing.
    if (params.protocolVersion !== 'auto' && !isSupportedProtocolVersion(params.protocolVersion)) {
      throw new UnsupportedProtocolVersionError(params.protocolVersion)
    }

    // Derived from `serverMethods`, not a hardcoded version check: a handler is refused
    // exactly when its own method (`sampling/createMessage`/`elicitation/create`/`roots/list`)
    // is absent from the configured revision — the client-side mirror of what
    // `@mokei/context-server` does per capability on the server side. Skipped here when the
    // revision is still `'auto'`: the revision isn't known yet, so `#setup()` re-runs this same
    // check (`#refuseUnsupportedHandlers`) once the probe resolves it — a handler accepted here
    // because the revision was unknown must still be refused if the probe lands on
    // `2026-07-28`, whose `serverMethods` is always empty.
    const protocol = params.protocolVersion === 'auto' ? null : PROTOCOLS[params.protocolVersion]
    if (protocol != null) {
      this.#refuseUnsupportedHandlers(protocol)
    }

    const capabilities: ClientCapabilities = {}
    if (params.elicit != null) {
      capabilities.elicitation = {}
    }
    if (params.createMessage != null) {
      capabilities.sampling = {}
    }
    if (params.listRoots != null) {
      capabilities.roots = {}
    }

    this.#capabilities = capabilities
    this.#clientInfo = params.clientInfo ?? DEFAULT_CLIENT_INFO
    this.#initialized = lazy(() => this.#initialize())
    this.#listMaxPages = params.listMaxPages ?? DEFAULT_LIST_MAX_PAGES
    this.#logLevel = params.logLevel
    this.#protocol = protocol
    this.#ready = lazy(() => this.#setup())
    this.#setupTimeout =
      params.setupTimeout ?? params.initializeTimeout ?? DEFAULT_INITIALIZE_TIMEOUT
    this.#notifications = new ReadableStream<HandleNotification>(
      {
        pull: (controller) => {
          const next = this.#notificationBuffer.shift()
          if (next != null) {
            controller.enqueue(next)
            return
          }
          // No buffered item: park until the next notification arrives.
          return new Promise<void>((resolve) => {
            this.#notificationPull = () => {
              this.#notificationPull = null
              const queued = this.#notificationBuffer.shift()
              if (queued != null) {
                controller.enqueue(queued)
              }
              resolve()
            }
          })
        },
        cancel: () => {
          this.#hasNotificationReader = false
          this.#notificationBuffer = []
          this.#notificationPull = null
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    )
  }

  /** Validates an inbound frame against the resolved revision's own server-message union. */
  #validateServerMessage(message: unknown): ReturnType<Validator<ServerMessage>> {
    const protocol = this.#protocol
    return protocol == null
      ? validateAnyServerMessage(message)
      : SERVER_MESSAGE_VALIDATORS[protocol.version](message)
  }

  /**
   * Throws when a handler is configured (`createMessage`/`elicit`/`listRoots`) whose method
   * (`sampling/createMessage`/`elicitation/create`/`roots/list`) is absent from `protocol`'s
   * `serverMethods` — derived from the method table, never a version literal. Called once at
   * construction for a fixed `protocolVersion`, and again from `#setup()` once an `'auto'`
   * probe resolves the revision, so a handler that was accepted only because the revision
   * wasn't known yet is still refused if the probe lands on `2026-07-28`.
   */
  #refuseUnsupportedHandlers(protocol: ProtocolDefinition): void {
    if (this.#createMessage != null && !protocol.serverMethods.has('sampling/createMessage')) {
      throw new MRTRNotSupportedError('createMessage', protocol.version)
    }
    if (this.#elicit != null && !protocol.serverMethods.has('elicitation/create')) {
      throw new MRTRNotSupportedError('elicit', protocol.version)
    }
    if (this.#listRoots != null && !protocol.serverMethods.has('roots/list')) {
      throw new MRTRNotSupportedError('listRoots', protocol.version)
    }
  }

  // Decorate every outgoing request with this revision's protocol envelope (`decorateRequest`)
  // and inject W3C trace context (SEP-414) into `_meta`; the latter is a no-op when no
  // OpenTelemetry SDK is active. Reject an `input_required` result until MRTR (SEP-2322) lands.
  //
  // Awaits `#ready` first (not just `#requireProtocol()`): `getPrompt`, `readResource` and
  // `callTool` call `request()` directly with no `#ready` await of their own, so under
  // `protocolVersion: 'auto'` this is the only thing that runs the probe before they'd
  // otherwise throw "not resolved yet". Safe against `#initialize()`, which never calls
  // `request()` — it writes/reads the transport directly via `super._write`/`#readUntil` — so
  // awaiting `#ready` here cannot deadlock against the handshake `#ready` itself is waiting on.
  //
  // Behavior change this introduces, deliberately not reverted: `ContextRPC.request()`
  // allocates the request ID synchronously, so awaiting `#ready` first means the *first* call
  // through this method now gets a higher ID than `#initialize()`'s own request — e.g. a
  // `2025-11-25` client whose first call is `getPrompt()` now sends `initialize` as id 0 and
  // `prompts/get` as id 1, where it used to be the other way around. Frame *order* on the wire
  // is unaffected (that's still `initialize` then `prompts/get`); only which integer each frame
  // carries changes. This is fine to accept rather than restore: request IDs are opaque
  // correlators that any conforming server matches by value, not by magnitude, and monotonic
  // allocation (setup always first) is strictly better than the old, inverted numbering. The
  // same reordering also means a caller-supplied `options.timeout` now starts only after setup
  // completes rather than covering it too — also fine, since `#setupTimeout` already bounds the
  // handshake/probe on its own, and a per-request timeout has no business being spent on
  // connection setup it didn't ask for. Hoisting this await into `getPrompt`/`readResource`/
  // `callTool` instead would not preserve the old numbering either: it would still await
  // readiness before `request()` allocates the ID, producing the identical result.
  async request<Method extends keyof ClientTypes['SendRequests']>(
    method: Method,
    params: ClientTypes['SendRequests'][Method]['Params'],
    options?: RequestOptions,
  ): Promise<ClientTypes['SendRequests'][Method]['Result']> {
    await this.#ready
    const protocol = this.#requireProtocol()
    // A method absent from the resolved revision's table is a local error, not a round-trip.
    // `ClientRequests` spans both revisions, so `request()` accepts `initialize`,
    // `logging/setLevel` and `server/discover` whatever revision is in play; the typed wrappers
    // for those three refuse the wrong revision themselves, but nothing stops a caller from
    // reaching past them to `request()`, and letting one through turns a clear "this revision
    // does not have that" into an opaque `-32601` from the peer.
    //
    // Placed after the `#ready` await so an `'auto'` client is gated on the revision it
    // resolved, never on an unresolved one. That cannot starve the probe that resolves it:
    // `#sendDiscover()` writes `server/discover` through `super._write` rather than through
    // this method.
    if (!protocol.clientMethods.has(method as string)) {
      throw new MethodNotInRevisionError(method as string, protocol.version)
    }
    const trace = currentTraceMeta()
    const base =
      params != null && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {}
    if (trace.traceparent != null) {
      base._meta = { ...(base._meta as Record<string, unknown> | undefined), ...trace }
    }
    const decorated = protocol.decorateRequest(base, {
      capabilities: this.#capabilities,
      clientInfo: this.#clientInfo,
      logLevel: this.#logLevel,
    })
    const result = await super.request(method, decorated as typeof params, options)
    if ((result as { resultType?: string } | undefined)?.resultType === 'input_required') {
      throw new InputRequiredNotSupportedError()
    }
    return result
  }

  /**
   * Stamps this revision's protocol `_meta` on an outgoing notification, the way `request()`
   * above does for requests. `ContextRPC.notify()` writes straight to the transport, so without
   * this a notification would name no revision at all.
   *
   * That matters most for `notifications/cancelled`, which `ContextRPC` emits itself when an
   * exchange is aborted or times out. A peer that routes each exchange on the version in its
   * body cannot place an unstamped one, and answers it with an error rather than acting on it —
   * so on a revision without a handshake, an undecorated cancellation silently leaves the peer
   * running a handler nobody is waiting for any more. Stamped, it routes, and a peer that has
   * no session to cancel within still acknowledges it and falls back to disconnect as its
   * cancellation signal.
   *
   * `decorateNotification` is the revision's own hook, not a version check here, and is identity
   * on `2025-11-25` — which needs no stamp, having agreed its version in the handshake.
   *
   * Awaits `#ready` to resolve the revision to decorate with. Not a change in when anything is
   * written: `_write` below already awaits `#ready`, so every notification already went out
   * behind it. Safe against setup, which sends `notifications/initialized` through `super._write`
   * rather than through here, so this await cannot be waiting on a handshake that waits on it.
   */
  async notify<Event extends keyof ClientTypes['SendNotifications'] & string>(
    event: Event,
    params: ClientTypes['SendNotifications'][Event]['params'],
  ): Promise<void> {
    await this.#ready
    const protocol = this.#requireProtocol()
    // The notification counterpart of `request()`'s `clientMethods` gate, and refused for the
    // same reason: `ClientNotifications` spans both revisions, so `initialized` and
    // `roots/list_changed` type-check on a `2026-07-28` client even though that revision's own
    // `clientMessage` union rejects the frames they produce. Stamping such a frame and putting
    // it on the wire buys nothing — a conformant peer refuses it — where a local error names the
    // actual problem. Derived from the revision's notification table, never a version literal.
    //
    // Compared against the *wire* method: `ContextRPC.notify` takes the suffix and prefixes
    // `notifications/` itself, and the protocol tables name methods as they appear on the wire.
    const method = `notifications/${event}`
    if (!protocol.clientNotifications.has(method)) {
      throw new MethodNotInRevisionError(method, protocol.version)
    }
    const decorated = protocol.decorateNotification(params)
    await super.notify(event, decorated as typeof params)
  }

  /**
   * Reads messages off the transport until one satisfies `matches`, bounded by `deadline`.
   * `label` names the request this bounded read is waiting on (`'initialize'` or
   * `'server/discover'`), used only in the closed-connection error message below.
   *
   * Shared by `#sendDiscover()` and `#initialize()` so both funnel through one outstanding
   * low-level read (`#pendingSetupRead`) instead of each issuing its own. `@enkaku/transport`'s
   * `Transport#read()` obtains the stream's reader once (`_getReader()`) and shares it, and per
   * the Streams spec, concurrent `reader.read()` calls on one reader are served FIFO — the
   * first pending read gets the next chunk, regardless of which caller issued it.
   *
   * That matters here because a probe can time out with its own `_read()` still pending (a
   * timed-out `Promise.race` doesn't cancel the loser). If the handshake that follows then
   * issued a *second*, independent `_read()`, the two would queue FIFO behind the reader: the
   * handshake's response would resolve the abandoned probe read first — silently discarded —
   * while the handshake's own read waits for a message that will never come, and dies with
   * `RequestTimeoutError`. Routing every setup-phase read through this one method avoids ever
   * having two outstanding low-level reads: a timed-out waiter leaves `#pendingSetupRead` in
   * place, and the next waiter (its own deadline, its own `matches`) awaits that *same* promise
   * instead of starting a new one — so whatever answers it, answers whichever waiter is
   * currently asking, in order. Messages that don't satisfy the current waiter's `matches` are
   * buffered (`#setupBuffer`), not dropped, so a later waiter with a different predicate can
   * still claim them, and so `_read()`'s override (see below) can hand them to the read loop
   * once setup finishes.
   *
   * Deliberately reads fresh data via `super._read()`, not `this._read()`: `_read()` is
   * overridden below to serve buffered leftovers first, which is exactly right for a caller
   * (`ContextRPC`'s read loop) that has no predicate of its own and just wants "the next
   * message, buffered or live" — but wrong here. This loop already scans the *entire*
   * `#setupBuffer` above for a match before ever asking for more data; if that scan finds
   * nothing, every buffered entry is confirmed non-matching. Calling the overridden `this._read()`
   * at that point would hand back one of those same confirmed-non-matching entries instead of
   * genuinely new data, which this loop would then push right back onto `#setupBuffer` — and
   * since the push never shrinks the buffer, the next iteration finds it non-empty again and
   * repeats forever, never once reaching the transport for the response this call is actually
   * waiting on. `super._read()` always performs a real transport read, sidestepping that.
   */
  async #readUntil(
    matches: (message: ServerMessage) => boolean,
    deadline: Promise<never>,
    label: string,
  ): Promise<ServerMessage> {
    while (true) {
      const index = this.#setupBuffer.findIndex(matches)
      if (index !== -1) {
        const [message] = this.#setupBuffer.splice(index, 1)
        return message
      }
      // Reuse a still-pending read left behind by an earlier, timed-out waiter rather than
      // issuing a fresh one — see the method comment above for why a second concurrent read
      // here would risk stealing the message this or a later waiter needs.
      this.#pendingSetupRead ??= super._read().finally(() => {
        this.#pendingSetupRead = null
      })
      const next = await Promise.race([this.#pendingSetupRead, deadline])
      if (next.done) {
        throw new Error(`Server closed the connection during ${label}`)
      }
      this.#setupBuffer.push(next.value)
    }
  }

  /**
   * A deadline rejecting with `RequestTimeoutError` once `#setupTimeout` elapses, for a request
   * named `method` (used only in the error message). Built once per bounded read, not per
   * iteration of `#readUntil`'s loop, so reading past stray messages doesn't accumulate abort
   * listeners on the underlying signal.
   *
   * Attaches a no-op `.catch()` to itself before returning: `#readUntil` can return via a
   * buffer hit (a match already sitting in `#setupBuffer`) without ever entering the
   * `Promise.race` that would otherwise be this promise's only listener. When that happens,
   * this deadline is still armed and rejects later, unattached — an unhandled rejection. Not
   * reachable today (the very first `#readUntil` call of a fresh setup always finds an empty
   * buffer), but cheap to close off now rather than wait for it to become reachable.
   */
  #setupDeadline(method: string): Promise<never> {
    const timeoutMs = this.#setupTimeout
    const deadline = AbortSignal.timeout(timeoutMs)
    const promise = new Promise<never>((_resolve, reject) => {
      const fail = () =>
        reject(
          new RequestTimeoutError(
            `Server did not respond to ${method} request within ${timeoutMs}ms`,
          ),
        )
      if (deadline.aborted) {
        fail()
      } else {
        deadline.addEventListener('abort', fail, { once: true })
      }
    })
    promise.catch(() => {})
    return promise
  }

  async #initialize(): Promise<InitializeResult> {
    const id = this._getNextRequestID()
    // The revision this client is configured to speak — not `LATEST_PROTOCOL_VERSION`: this
    // client implements exactly one revision's wire behavior, so declaring anything else in
    // the handshake would misrepresent what it can actually speak.
    const protocol = this.#requireProtocol()
    // Send initialize request
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        ...DEFAULT_INITIALIZE_PARAMS,
        clientInfo: this.#clientInfo,
        capabilities: this.#capabilities,
        protocolVersion: protocol.version,
      },
    })
    const deadline = this.#setupDeadline('initialize')
    // Drops anything that isn't the initialize response by construction: `matches` only
    // accepts this request's own id, so pre-init notifications and server requests are left in
    // `#setupBuffer` rather than handled here — they can't be, before the session exists.
    const message = await this.#readUntil(
      (candidate) => candidate.id === id,
      deadline,
      'initialize',
    )
    if ('error' in message) {
      throw RPCError.fromResponse(message as ErrorResponse)
    }
    const result = message.result as InitializeResult
    // Reject a negotiated version other than the one this client is configured to speak.
    //
    // This `dispose()` runs twice whenever the handshake is driven from `#setup()` — which is
    // every path, since `#setup()` awaits `#initialized` for a handshake revision and every
    // public method now awaits `#ready`. The throw propagates out of that await into `#setup()`'s
    // blanket catch, which disposes again. Harmless, and relied on rather than worked around:
    // `Disposer.dispose()` is idempotent — it aborts an `AbortController` behind a `once`
    // listener and a latch, then returns the same `#deferred.promise`, already settled here
    // because the first call is awaited to completion before the throw propagates.
    if (result.protocolVersion !== protocol.version) {
      await this.dispose()
      throw new UnsupportedProtocolVersionError(result.protocolVersion, protocol.version)
    }
    // Store server capabilities for client-side gating.
    this.#serverCapabilities = result.capabilities
    // Start listening for incoming messages
    this.#startReadLoop()
    // Notify server that client is initialized
    await super._write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    this.events.emit('initialized', result)
    return result
  }

  /**
   * One rule for every setup failure: dispose the transport, then rethrow.
   *
   * `#ready` is `lazy()`, so a rejection here is cached for the client's lifetime — every later
   * `request()`/`_write()`/`discover()` gets the same error, the read loop never starts, and
   * nothing else will ever call `dispose()` on the caller's behalf. By this point a stdio
   * client's server process is already spawned, so leaving the transport open leaks that
   * process. The blanket catch covers the handshake's own RPC error, the bounded-read deadline,
   * a connection closed mid-setup, `#refuseUnsupportedHandlers` and `#startReadLoop()`'s
   * invariant assertion, rather than leaving each to decide independently.
   *
   * The `#refuseUnsupportedHandlers` re-check inside is not redundant with the constructor's:
   * under `protocolVersion: 'auto'` the revision wasn't known yet there, so a handler accepted
   * then must still be refused if the probe lands on `2026-07-28`, whose `serverMethods` is
   * always empty.
   */
  async #setup(): Promise<void> {
    try {
      // `#probe()` already issued (and seeded from) a `server/discover` of its own, so a
      // resolved `'auto'` connection must not send a second one here.
      const probed = this.#protocol == null
      const protocol = this.#protocol ?? (await this.#probe())
      this.#protocol = protocol
      this.#refuseUnsupportedHandlers(protocol)
      if (protocol.requiresHandshake) {
        await this.#initialized
        return
      }
      if (!probed) {
        await this.#setupDiscover()
      }
      this.#startReadLoop()
    } catch (cause) {
      await this.dispose()
      throw cause
    }
  }

  /**
   * The setup-time liveness check for a revision with no handshake, and the counterpart to
   * `#initialize()` on one that has it.
   *
   * Without it nothing in setup is bounded at all on such a revision — `#setupTimeout` covers
   * only the handshake and the `'auto'` probe, and `ContextRPC.request` arms a timer only when
   * the caller passes `options.timeout` — so a server that is spawned but never writes a byte
   * hangs its host forever rather than failing in `#setupTimeout` the way the same server does
   * on `2025-11-25`. One bounded round trip restores that bound.
   *
   * Not free, and not claimed to be. A client whose first call is capability-gated pays nothing:
   * `#seedDiscovery` hands that call the answer it would have fetched itself. A client whose
   * calls are all ungated — `prompts/list`, `resources/read`, `getPrompt` never consult
   * capabilities — sends one request per connection it did not send before. That is the cost of
   * having any liveness bound at all here, which is worth more than the request it costs.
   *
   * An error *response* is accepted, not raised: it proves the connection is live, which is the
   * whole point of the round trip, and a revision that does not mandate discovery may be served
   * by a peer that simply does not implement it. Refusing there would turn a working connection
   * into a failed one. Only silence — a `#setupTimeout` expiry, or the connection closing —
   * fails setup, which is exactly the "mute server" case this exists to catch. A caller that
   * needs the result itself still gets the error, from its own `discover()`.
   *
   * Stamps with `#requireProtocol()`, not with {@link PROBE_PROTOCOL}: this runs *after* the
   * revision is resolved, so the revision is known and there is nothing to guess. Reusing the
   * probe's stamp here would label a future handshake-less revision's setup frame `2026-07-28`
   * — a version literal standing in for a capability, which is what the capability-derived gate
   * above it exists to avoid.
   */
  async #setupDiscover(): Promise<void> {
    let result: DiscoverResult
    try {
      result = await this.#sendDiscover(this.#requireProtocol())
    } catch (cause) {
      if (cause instanceof RPCError) {
        return
      }
      throw cause
    }
    this.#seedDiscovery(result)
  }

  /**
   * Seeds both discover-derived caches from a `server/discover` answered during setup, so the
   * first gated call does not issue a second identical request. `#discovered` honors the
   * server's own `ttlMs` exactly as `discover()` would; `#serverCapabilitySnapshot` is seeded
   * unconditionally, per the connection-lifetime argument on that field.
   */
  #seedDiscovery(result: DiscoverResult): void {
    const ttlMs = typeof result.ttlMs === 'number' && result.ttlMs > 0 ? result.ttlMs : 0
    this.#discovered = { result, expiresAt: Date.now() + ttlMs }
    this.#serverCapabilitySnapshot = result.capabilities ?? {}
  }

  /**
   * Probes the server with `server/discover` to resolve `protocolVersion: 'auto'`, per
   * `specification/2026-07-28/basic/transports/stdio#backward-compatibility`: a `DiscoverResult`
   * identifies a `2026-07-28` server; anything else — an unrecognized-method error, a timeout,
   * or any other failure — falls back to the `2025-11-25` handshake. A `-32022`
   * (`UNSUPPORTED_PROTOCOL_VERSION`) response is the one exception that still carries useful
   * information on the way down: its `data.supported` names the versions the server does speak,
   * so the fallback negotiates the newest one both sides support instead of assuming
   * `2025-11-25` outright.
   *
   * Invariant this relies on, enforced by the assertion in `#startReadLoop()`: whatever
   * revision this method falls back to must have `requiresHandshake: true`. `#initialize()` is
   * the only setup path that calls `#startReadLoop()` *after* consuming the one outstanding
   * `#pendingSetupRead` down to `null` — a fallback landing on a revision without a handshake
   * would instead go straight to `#setup()`'s own `#startReadLoop()` call with no guarantee
   * `#pendingSetupRead` has settled, reopening the original FIFO-steal bug `#readUntil()`
   * exists to prevent. Every revision this function can fall back to today requires a
   * handshake, so the invariant currently holds by construction, not by choice made here.
   */
  async #probe(): Promise<ProtocolDefinition> {
    const candidate = PROBE_PROTOCOL
    if (candidate == null) {
      // No registered revision is both handshake-less and able to send `server/discover`, so
      // there is nothing to probe *with*. Not reachable with today's registry; the branch exists
      // so that a registry which stops carrying such a revision degrades `'auto'` to the
      // handshake rather than failing the connection — or, if this were computed eagerly at
      // module scope, crashing the import for every consumer including those that never probe.
      return this.#fallBackFromProbe([], null)
    }
    try {
      // Seeded, not discarded: the probe's answer is a full `DiscoverResult`, and throwing it
      // away made every `'auto'` connection send `server/discover` a second time on its first
      // gated call — a redundant POST per connection over HTTP.
      this.#seedDiscovery(await this.#sendDiscover(candidate))
      return candidate
    } catch (cause) {
      const supported =
        cause instanceof RPCError && cause.code === UNSUPPORTED_PROTOCOL_VERSION
          ? ((cause.data as { supported?: Array<string> } | undefined)?.supported ?? [])
          : []
      return this.#fallBackFromProbe(supported, candidate.version)
    }
  }

  /**
   * Settles on a handshake revision when the probe cannot resolve one, and returns it.
   *
   * `supported` is whatever the server named in a `-32022` (empty for any other failure);
   * `refused` is the revision the probe just tried, excluded from the result even if the
   * server's own `data.supported` erroneously lists it — the caller only reaches here because
   * the server rejected that exact version, so re-selecting it would hand back a revision with
   * no handshake that the server has already refused to speak, leaving every gated call
   * re-issuing `server/discover` forever with no way to make progress.
   */
  #fallBackFromProbe(
    supported: Array<string>,
    refused: ProtocolVersion | null,
  ): ProtocolDefinition {
    const agreed = PROTOCOL_VERSIONS.find(
      (version) => version !== refused && supported.includes(version),
    )
    this.#protocol = agreed == null ? PROTOCOLS['2025-11-25'] : PROTOCOLS[agreed]
    // A capability snapshot or cached discover() result taken from the failed probe must not
    // survive into the connection that replaces it.
    this.#resetDiscovery()
    return this.#protocol
  }

  /**
   * Sends `server/discover` directly on the transport (`super._write`), bypassing
   * `ContextRPC`'s request/exchange machinery: `#startReadLoop()` hasn't run yet — resolving
   * whether it should is the point of the probe that is one of this method's two callers — so
   * there is no read loop to route a response through yet. Reads the response via
   * `#readUntil()`, sharing its bounded-read state with `#initialize()` so a probe timeout can't
   * cause the handshake that follows to lose its response (see `#readUntil()`'s comment).
   *
   * `protocol` is the revision whose envelope stamps the outgoing frame, and it is a parameter
   * rather than a constant because the two callers know different things. `#setupDiscover()`
   * runs once the revision is resolved and passes that revision. `#probe()` runs before any
   * revision is known and passes {@link PROBE_PROTOCOL}, a registry-derived guess. Hardcoding
   * either here would stamp a future handshake-less revision's setup frame with an older
   * revision's version — a version literal standing in for a capability.
   *
   * Sends the same `clientInfo`/`logLevel` context `request()` sends with every other request,
   * plus the same W3C trace context (SEP-414) `request()` injects into `_meta` via
   * `currentTraceMeta()`: the spec says a client SHOULD send `clientInfo`, and there's no reason
   * for the one-off setup request to present a different envelope to the server than any request
   * that follows it — a server keying logs, metrics or trace correlation off
   * `clientInfo`/`traceparent` shouldn't see a gap for the request that established the
   * connection.
   */
  async #sendDiscover(protocol: ProtocolDefinition): Promise<DiscoverResult> {
    const id = this._getNextRequestID()
    const trace = currentTraceMeta()
    const base: Record<string, unknown> = {}
    if (trace.traceparent != null) {
      base._meta = { ...trace }
    }
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'server/discover',
      params: protocol.decorateRequest(base, {
        capabilities: this.#capabilities,
        clientInfo: this.#clientInfo,
        logLevel: this.#logLevel,
      }),
    } as ClientMessage)
    const deadline = this.#setupDeadline('server/discover')
    const message = await this.#readUntil(
      (candidate) => candidate.id === id,
      deadline,
      'server/discover',
    )
    if ('error' in message) {
      throw RPCError.fromResponse(message as ErrorResponse)
    }
    const discovered = validateDiscoverResult(message.result)
    if (discovered.issues != null) {
      throw new RPCError(INVALID_REQUEST, 'Invalid server/discover result')
    }
    return discovered.value
  }

  /**
   * Clears both discover-derived caches together: `#discovered` (`discover()`'s own
   * `ttlMs`-governed cache) and `#serverCapabilitySnapshot` (the connection-lifetime gating
   * snapshot). Two callers: `#probe()`'s fallback path, so a result cached from the failed
   * `2026-07-28` probe attempt cannot leak into the `2025-11-25` connection that replaces it,
   * and `_handleNotification` on a `*_list_changed` notification, the one way a live
   * connection's declared capabilities change — see the field comment on
   * `#serverCapabilitySnapshot`.
   */
  #resetDiscovery(): void {
    this.#discovered = null
    this.#serverCapabilitySnapshot = null
  }

  /** The resolved protocol record. Throws while an `'auto'` probe is still pending. */
  #requireProtocol(): ProtocolDefinition {
    if (this.#protocol == null) {
      throw new Error("The 'auto' protocol version has not been resolved yet")
    }
    return this.#protocol
  }

  /**
   * Starts `ContextRPC`'s read loop exactly once, across probe and handshake.
   *
   * Asserts `#pendingSetupRead == null`: the read loop and `#readUntil()` must never have an
   * outstanding low-level read in flight at the same time, or the FIFO-steal bug `#readUntil()`
   * exists to prevent returns — a read meant for `#readUntil()`'s caller could instead resolve
   * whichever `_read()` call `ContextRPC`'s read loop just issued, and vice versa. Every setup
   * path that reaches here has already consumed `#pendingSetupRead` down to `null` via the
   * response that unblocked its own bounded read — the initialize response for `#initialize()`,
   * the `server/discover` response for `#setupDiscover()` and `#probe()` — each immediately
   * before this method runs. A bounded read that instead *times out* leaves the field set, but
   * also throws, so `#setup()` disposes rather than reaching here. See `#probe()`'s comment for
   * the one assumption this depends on.
   */
  #startReadLoop(): void {
    if (this.#reading) {
      return
    }
    if (this.#pendingSetupRead != null) {
      throw new Error(
        '#startReadLoop() invariant violated: a setup-phase read is still outstanding',
      )
    }
    this.#reading = true
    this._handle()
  }

  /**
   * Serves `#setupBuffer`'s leftovers before touching the transport. `ContextRPC`'s read loop
   * (`#readLoop` in `rpc.ts`) calls `this._read()` in an unconditional loop once
   * `#startReadLoop()` starts it, with no knowledge of `#setupBuffer`'s existence — this
   * override is what makes that safe. Anything left in `#setupBuffer` once setup finishes (a
   * notification or server request that arrived during the probe/handshake window and matched
   * no setup-phase waiter's predicate) is drained here as the read loop's first reads, in
   * arrival order, before it ever reaches `super._read()` for genuinely new data. This is the
   * single place `#setupBuffer` is drained for that purpose — `#readUntil()` deliberately does
   * not call this override for its own reads (see its comment for why doing so would deadlock).
   */
  async _read(): Promise<ReadableStreamReadResult<ServerMessage>> {
    if (this.#setupBuffer.length > 0) {
      const value = this.#setupBuffer.shift() as ServerMessage
      return { done: false, value }
    }
    return await super._read()
  }

  _onTransportClosed(reason?: Error): void {
    this.events.emit('closed', { error: reason })
  }

  // Override _write to ensure the client is set up (handshake or read loop start) before
  // sending messages.
  async _write(message: ClientMessage): Promise<void> {
    await this.#ready
    await super._write(message)
  }

  _handleNotification(notification: HandleNotification): void {
    if (notification.method === 'notifications/message') {
      this.events.emit('log', notification.params)
    }
    // Clear tool output schemas cache on tools/list_changed notification
    if (notification.method === 'notifications/tools/list_changed') {
      this.#toolOutputSchemas.clear()
    }
    // The one thing that can change a live connection's declared capabilities without a
    // handshake — the exception `#serverCapabilitySnapshot`'s soundness argument rests on. Both
    // discover-derived caches go, or the gate and `discover()` disagree for the rest of the
    // connection.
    if (LIST_CHANGED_NOTIFICATIONS.has(notification.method)) {
      this.#resetDiscovery()
    }
    // Drop until a reader attaches, then keep only the most recent CAP.
    if (!this.#hasNotificationReader) {
      return
    }
    this.#notificationBuffer.push(notification)
    if (this.#notificationBuffer.length > NOTIFICATION_BUFFER_CAP) {
      this.#notificationBuffer.shift()
    }
    this.#notificationPull?.()
  }

  async _handleRequest(request: ServerRequest, signal: AbortSignal): Promise<ClientResult> {
    // Answered here rather than in `ContextRPC`, which stays MCP-version-agnostic: `ping` exists
    // only in the revisions whose `serverMethods` carries it, and the spec makes answering it a
    // MUST there. Gated on the method table, not a version literal, and mirroring
    // `ContextServer._handleRequest`'s own `ping` case.
    if (request.method === 'ping' && this.#requireProtocol().serverMethods.has('ping')) {
      return {}
    }
    switch (request.method) {
      case 'elicitation/create': {
        if (this.#elicit != null) {
          return await this.#elicit({ params: request.params, signal })
        }
        break
      }
      case 'roots/list': {
        if (this.#listRoots == null) {
          throw new RPCError(METHOD_NOT_FOUND, 'roots capability not supported')
        }
        const roots = Array.isArray(this.#listRoots)
          ? this.#listRoots
          : await this.#listRoots({ signal })
        return { roots }
      }
      case 'sampling/createMessage':
        if (this.#createMessage != null) {
          return await this.#createMessage({ params: request.params, signal })
        }
    }
    throw new RPCError(METHOD_NOT_FOUND, 'Method not implemented')
  }

  // Guard: throws synchronously when the server did not declare the given capability.
  // Only meaningful after initialize() completes; #serverCapabilities is {} until then.
  // Narrowed to 'logging': the handshake-only gate, still reading #serverCapabilities directly.
  // 'tools' and 'completions' route through #requireServerCapabilityAsync instead, which reads
  // the discover-backed snapshot on a revision without a handshake.
  #requireServerCapability(capability: 'logging'): void {
    if (this.#serverCapabilities[capability] == null) {
      throw new CapabilityNotDeclaredError(capability)
    }
  }

  // Guard: throws when the server did not declare the given capability, reading from whichever
  // source this revision actually populates. `2025-11-25` has a handshake, so `#serverCapabilities`
  // is authoritative. `2026-07-28` has none, so the only way to learn what the server supports is
  // `discover()` — but calling `discover()` on every gated call would mean sending
  // `server/discover` before every `tools/list`/`completion/complete` forever (an unconfigured
  // server's `ttlMs` defaults to 0, so `discover()`'s own cache never hits). Since a revision
  // without a handshake also has no way for a live connection's declared capabilities to change
  // except via a `*_list_changed` notification, it's sound to call `discover()` at most once per
  // connection here and snapshot the result for the connection's lifetime, independent of
  // `discover()`'s `ttlMs`-governed cache.
  async #requireServerCapabilityAsync(
    capability: 'tools' | 'completions',
    options?: RequestOptions,
  ): Promise<void> {
    const protocol = this.#requireProtocol()
    let capabilities: ServerCapabilities
    if (protocol.requiresHandshake) {
      capabilities = this.#serverCapabilities
    } else {
      if (this.#serverCapabilitySnapshot == null) {
        const result = await this.discover(options)
        this.#serverCapabilitySnapshot = result.capabilities
      }
      capabilities = this.#serverCapabilitySnapshot
    }
    if (capabilities[capability] == null) {
      throw new CapabilityNotDeclaredError(capability)
    }
  }

  get notifications(): ReadableStream<ServerNotification> {
    this.#hasNotificationReader = true
    return this.#notifications as ReadableStream<ServerNotification>
  }

  /** The resolved protocol revision. Throws while an `'auto'` probe is still pending. */
  get protocolVersion(): ProtocolVersion {
    return this.#requireProtocol().version
  }

  /**
   * The `2025-11-25` handshake result — server capabilities and identity.
   *
   * Awaits `#ready` like every other public method here. Under `protocolVersion: 'auto'` the
   * revision is unresolved until the probe runs, and the probe only runs when something awaits
   * `#ready`; without this await `#requireProtocol()` threw "not resolved yet" before the probe
   * that would have resolved it ever started. That made this method unusable on every `'auto'`
   * client — and unworkable around, since it is the only accessor for an `InitializeResult`:
   * calling anything else first to force the probe resolves the handshake without handing the
   * result back.
   *
   * No deadlock against the handshake `#ready` itself waits on: `#setup()` awaits `#initialized`
   * for a handshake revision, and `#initialize()` writes and reads the transport directly rather
   * than going through `request()`, so nothing re-enters `#ready` from underneath.
   *
   * Two consequences of routing through `#ready`, both accepted rather than special-cased, since
   * one rule for every public method is what kept this method's omission invisible in the first
   * place. On a handshake-less revision the only possible outcome is the throw below, but setup
   * runs first, so a `2026-07-28` caller using this as feature detection pays the full
   * `setupTimeout` against an unresponsive server instead of an immediate error — `discover()`
   * has the mirror shape, running the whole `2025-11-25` handshake before refusing. And a failed
   * handshake now disposes: the caller sees the same error either way, but the transport no
   * longer survives it, which is the point — `#initialized` is a `lazy()` memo of the rejection,
   * so nothing was retryable and a spawned server was left with nobody to dispose it.
   */
  async initialize(): Promise<InitializeResult> {
    await this.#ready
    const protocol = this.#requireProtocol()
    if (!protocol.requiresHandshake) {
      throw new Error(
        `initialize() is not applicable to protocol version ${protocol.version}: it does not require a handshake`,
      )
    }
    return await this.#initialized
  }

  /**
   * Queries a server's supported protocol versions, capabilities and identity — the
   * `2026-07-28` replacement for the `initialize` handshake. Result is cached per the
   * server's own `ttlMs`; concurrent callers while a request is in flight collapse onto it.
   * `cacheScope` is read implicitly, not explicitly: this cache lives on one client instance,
   * so it is inherently private, and `'private'` is honored by construction regardless of what
   * the server sends.
   *
   * Awaits `#ready` like every other public method here (`setLoggingLevel`, `complete`,
   * `listTools`, `#listPaged`), so a first call under `protocolVersion: 'auto'` probes rather
   * than throwing "not resolved yet".
   *
   * This is the `ttlMs`-governed cache for direct callers. `#requireServerCapabilityAsync`
   * does not use it for gating — see `#serverCapabilitySnapshot`.
   */
  async discover(options?: RequestOptions): Promise<DiscoverResult> {
    await this.#ready
    const protocol = this.#requireProtocol()
    if (protocol.requiresHandshake) {
      throw new Error(
        `server/discover does not exist in protocol version ${protocol.version}; use initialize()`,
      )
    }
    if (this.#discovered != null && Date.now() < this.#discovered.expiresAt) {
      return this.#discovered.result
    }
    // Collapse concurrent callers onto one in-flight request. Note the coupling this creates:
    // whichever caller's invocation wins this `??=` imposes its own `options` (signal, timeout)
    // on every other concurrent awaiter, so one caller's abort/timeout rejects another caller's
    // `discover()` too, even though that caller passed different (or no) options.
    this.#discovering ??= this.request('server/discover', {}, options)
      .then((result) => {
        const ttlMs = typeof result.ttlMs === 'number' && result.ttlMs > 0 ? result.ttlMs : 0
        this.#discovered = { result, expiresAt: Date.now() + ttlMs }
        return result
      })
      .finally(() => {
        this.#discovering = null
      })
    return await this.#discovering
  }

  async setLoggingLevel(params: WithRequestOptions<SetLevelRequest['params']>): Promise<Result> {
    await this.#ready
    const protocol = this.#requireProtocol()
    // Derived from `clientMethods`, not a version literal: refuses exactly when this
    // revision's method table has no `logging/setLevel` to send. Deliberately does not route
    // through `discover()`'s capabilities — `2026-07-28` still advertises `logging: {}` even
    // though the method itself is gone, so gating on capabilities would let this through and
    // earn a METHOD_NOT_FOUND from the server instead of this clearer, client-side refusal.
    if (!protocol.clientMethods.has('logging/setLevel')) {
      throw new MethodNotInRevisionError(
        'logging/setLevel',
        protocol.version,
        'the log level travels per request via _meta instead (see ClientParams.logLevel)',
      )
    }
    this.#requireServerCapability('logging')
    const [wireParams, options] = splitRequestOptions(params)
    return await this.request('logging/setLevel', wireParams, options)
  }

  async complete(params: WithRequestOptions<CompleteRequest['params']>): Promise<CompleteResult> {
    await this.#ready
    const [wireParams, options] = splitRequestOptions(params)
    await this.#requireServerCapabilityAsync('completions', options)
    return await this.request('completion/complete', wireParams, options)
  }

  /**
   * Walks a paginated list method until the server stops returning a cursor.
   *
   * Takes the caller's merged params and separates the wire params from the pagination
   * and transport options, so the list methods never hand the latter to `request`.
   *
   * When `cursor` is set the caller is driving pagination: a single request is issued and
   * its page returned verbatim, `nextCursor` intact.
   */
  async #listPaged(
    method: string,
    key: string,
    send: (params: Record<string, unknown>, options: RequestOptions) => Promise<PagedResult>,
    listParams: ListParams<Record<string, unknown>>,
  ): Promise<PagedResult> {
    await this.#ready

    const [params, { maxPages: maxPagesParam, ...options }] = splitListOptions(listParams)

    if (params.cursor != null) {
      return await send(params, options)
    }

    const maxPages = maxPagesParam ?? this.#listMaxPages
    const items: Array<unknown> = []
    let cursor: string | undefined
    let pages = 0

    while (true) {
      const page = await send(cursor == null ? params : { ...params, cursor }, options)
      pages += 1

      const pageItems = page[key]
      if (Array.isArray(pageItems)) {
        items.push(...pageItems)
      }

      if (page.nextCursor == null) {
        const { nextCursor: _nextCursor, ...rest } = page
        return { ...rest, [key]: items }
      }
      if (pages >= maxPages) {
        throw new ListMaxPagesError(method, pages, page.nextCursor, items)
      }
      cursor = page.nextCursor
    }
  }

  async listPrompts(
    params: ListParams<ListPromptsRequest['params']> = {},
  ): Promise<ListPromptsResult> {
    const result = await this.#listPaged(
      'prompts/list',
      'prompts',
      (pageParams, options) =>
        this.request(
          'prompts/list',
          pageParams as ListPromptsRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )
    return result as ListPromptsResult
  }

  getPrompt(params: WithRequestOptions<PromptParams<T>>): Promise<GetPromptResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('prompts/get', wireParams as GetPromptRequest['params'], options)
  }

  async listResources(
    params: ListParams<ListResourcesRequest['params']> = {},
  ): Promise<ListResourcesResult> {
    const result = await this.#listPaged(
      'resources/list',
      'resources',
      (pageParams, options) =>
        this.request(
          'resources/list',
          pageParams as ListResourcesRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )
    return result as ListResourcesResult
  }

  async listResourceTemplates(
    params: ListParams<ListResourceTemplatesRequest['params']> = {},
  ): Promise<ListResourceTemplatesResult> {
    const result = await this.#listPaged(
      'resources/templates/list',
      'resourceTemplates',
      (pageParams, options) =>
        this.request(
          'resources/templates/list',
          pageParams as ListResourceTemplatesRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )
    return result as ListResourceTemplatesResult
  }

  readResource(
    params: WithRequestOptions<ReadResourceRequest['params']>,
  ): Promise<ReadResourceResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('resources/read', wireParams, options)
  }

  async listTools(params: ListParams<ListToolsRequest['params']> = {}): Promise<ListToolsResult> {
    await this.#ready
    const [, gateOptions] = splitRequestOptions(params)
    await this.#requireServerCapabilityAsync('tools', gateOptions)
    const result = (await this.#listPaged(
      'tools/list',
      'tools',
      (pageParams, options) =>
        this.request(
          'tools/list',
          pageParams as ListToolsRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )) as ListToolsResult
    this._cacheToolOutputSchemas(result.tools)
    return result
  }

  /** @internal Memoises validators for tools that advertise an outputSchema. */
  _cacheToolOutputSchemas(tools: ListToolsResult['tools']): void {
    for (const tool of tools) {
      if (tool.outputSchema == null) {
        this.#toolOutputSchemas.delete(tool.name)
        continue
      }
      const schema = tool.outputSchema as Schema
      this.#toolOutputSchemas.set(
        tool.name,
        createValidator(schema, { draft: inferSchemaDraft(schema), strict: false }),
      )
    }
  }

  async callTool(params: WithRequestOptions<ToolParams<T>>): Promise<CallToolResult> {
    const [wireParams, options] = splitRequestOptions(params)
    const result = await this.request(
      'tools/call',
      wireParams as CallToolRequest['params'],
      options,
    )
    const validate = this.#toolOutputSchemas.get(params.name)
    if (validate == null || result.structuredContent == null) {
      return result
    }
    const outcome = validate(result.structuredContent)
    if (outcome.issues != null) {
      throw new StructuredContentValidationError(
        params.name,
        outcome.issues.map((issue) => ({
          message: issue.message,
          path: issue.path?.map((segment) =>
            typeof segment === 'object' && segment != null ? segment.key : segment,
          ),
        })),
      )
    }
    return result
  }
}
