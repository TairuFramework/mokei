import type {
  ClientCapabilities,
  ClientMessage,
  DiscoverResult,
  Implementation,
  InitializeResult,
  LoggingLevel,
  ProtocolDefinition,
  ProtocolVersion,
  RequestID,
  ServerMessage,
} from '@mokei/context-protocol'
import { discoverResult, type ErrorResponse, INVALID_REQUEST } from '@mokei/context-protocol'
import { RequestTimeoutError, RPCError } from '@mokei/context-rpc'
import { createValidator } from '@sozai/schema'

import { currentTraceMeta } from './trace.js'

/**
 * Validates a `server/discover` result against `2026-07-28`'s own schema. `discoverResult` is not
 * a member of `2025-11-25`'s `serverResult` — `server/discover` does not exist on that revision,
 * and `driveDiscover` below is only ever called once a handshake-less revision is known or being
 * probed — so one validator covers every caller.
 */
const validateDiscoverResult = createValidator(discoverResult)

/**
 * Narrow I/O seam `SetupReader` uses to drive `initialize` / `server/discover`. Backed by
 * `ContextClient`'s private `#setupBuffer` / `#pendingSetupRead` fields, which stay inside
 * `ContextClient` — `SetupReader` never touches them directly, only through the closures below,
 * constructed by `ContextClient` (the only place that can reference its own `#`-private fields).
 */
export type SetupIO = {
  /** Allocates the next outgoing request id. Backed by `ContextRPC#_getNextRequestID`. */
  allocateId(): RequestID

  /** Writes a frame straight to the transport, bypassing RPC correlation. Backed by `super._write`. */
  write(message: ClientMessage): Promise<void>

  /**
   * Scans the shared unmatched-frame buffer for an entry satisfying `matches`, removing and
   * returning it if found, else `undefined`. Must be tried on every loop iteration BEFORE
   * `readNextFrame()` — draining the buffer FIFO-style instead of by predicate reintroduces an
   * infinite loop on a stray buffered frame (a non-matching entry handed back forever without a
   * fresh transport read ever being attempted). Buffer stays owned by `ContextClient`.
   */
  takeBuffered(matches: (message: ServerMessage) => boolean): ServerMessage | undefined

  /**
   * One raw transport read, deduped against any already-outstanding low-level read (so two
   * overlapping setup exchanges — e.g. a timed-out probe followed by the handshake — never issue
   * two independent transport reads and risk the FIFO-steal bug the original `#readUntil()`'s
   * comment describes).
   */
  readNextFrame(): Promise<ReadableStreamReadResult<ServerMessage>>

  /**
   * Hands a frame that did not match the current waiter back to the shared buffer, so a later
   * waiter with a different predicate (or the post-setup `_read()` drain) can still claim it.
   */
  handBackFrame(message: ServerMessage): void
}

/**
 * Drives the `initialize` / `server/discover` setup exchanges over a narrow {@link SetupIO}
 * adapter. Extracted from `ContextClient`'s `#initialize()`/`#sendDiscover()`/`#readUntil()`/
 * `#setupDeadline()` cluster; owns the read-until-match loop, the deadline construction, and the
 * request-building/response-parsing shape for both exchanges.
 *
 * What stays the caller's job: the `RPCError`/`UnsupportedProtocolVersionError` *interpretation*
 * of what comes back — whether the negotiated revision matches the one the caller asked for,
 * whether the transport should be disposed on failure — see `ContextClient#initialize`.
 */
export class SetupReader {
  #io: SetupIO
  #setupTimeout: number

  constructor(io: SetupIO, setupTimeout: number) {
    this.#io = io
    this.#setupTimeout = setupTimeout
  }

  /**
   * A deadline rejecting with `RequestTimeoutError` once `setupTimeout` elapses, for a request
   * named `method` (used only in the error message). Built once per bounded read, not per
   * iteration of `#readMatching`'s loop, so reading past stray messages doesn't accumulate abort
   * listeners on the underlying signal.
   *
   * Attaches a no-op `.catch()` to itself before returning: `#readMatching` can return via a
   * buffer hit (a match already sitting in the shared buffer) without ever entering the
   * `Promise.race` that would otherwise be this promise's only listener. When that happens, this
   * deadline is still armed and rejects later, unattached — an unhandled rejection otherwise.
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

  /**
   * Reads frames until one satisfies `matches`, bounded by `deadline`. The shared primitive
   * behind both `driveInitialize` and `driveDiscover` — mirrors the original `ContextClient`
   * `#readUntil` loop exactly (buffer scan first, then a deduped raw read, then an unconditional
   * hand-back), just phrased over the `SetupIO` closures instead of `ContextClient`'s own private
   * fields. The buffer scan is a distinct predicate-scored scan, not a FIFO pop — see
   * {@link SetupIO.takeBuffered}'s comment for why the two are not interchangeable.
   */
  async #readMatching(
    matches: (message: ServerMessage) => boolean,
    deadline: Promise<never>,
    label: string,
  ): Promise<ServerMessage> {
    while (true) {
      const buffered = this.#io.takeBuffered(matches)
      if (buffered != null) {
        return buffered
      }
      const next = await Promise.race([this.#io.readNextFrame(), deadline])
      if (next.done) {
        throw new Error(`Server closed the connection during ${label}`)
      }
      this.#io.handBackFrame(next.value)
    }
  }

  /** Drives the `initialize` handshake; returns its result and the revision it negotiated. */
  async driveInitialize(request: {
    protocolVersion: ProtocolVersion
    clientInfo: Implementation
    capabilities: ClientCapabilities
  }): Promise<{ result: InitializeResult; negotiatedRevision: ProtocolVersion }> {
    const id = this.#io.allocateId()
    await this.#io.write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        capabilities: request.capabilities,
        clientInfo: request.clientInfo,
        protocolVersion: request.protocolVersion,
      },
    } as ClientMessage)
    const deadline = this.#setupDeadline('initialize')
    // Drops anything that isn't the initialize response by construction: `matches` only accepts
    // this request's own id, so pre-init notifications and server requests are left buffered
    // rather than handled here — they can't be, before the session exists.
    const message = await this.#readMatching(
      (candidate) => candidate.id === id,
      deadline,
      'initialize',
    )
    if ('error' in message) {
      throw RPCError.fromResponse(message as ErrorResponse)
    }
    const result = message.result as InitializeResult
    return { result, negotiatedRevision: result.protocolVersion as ProtocolVersion }
  }

  /** Drives one `server/discover` exchange (used by both the probe and post-resolution setup). */
  async driveDiscover(request: {
    protocol: ProtocolDefinition
    clientInfo: Implementation
    capabilities: ClientCapabilities
    logLevel?: LoggingLevel
  }): Promise<{ result: DiscoverResult; negotiatedRevision: ProtocolVersion }> {
    const { protocol } = request
    const id = this.#io.allocateId()
    // Sends the same `clientInfo`/`logLevel` context every other request sends, plus the same
    // W3C trace context (SEP-414) `ContextClient#request` injects into `_meta` via
    // `currentTraceMeta()`: the spec says a client SHOULD send `clientInfo`, and there's no
    // reason for this one-off setup request to present a different envelope to the server than
    // any request that follows it.
    const trace = currentTraceMeta()
    const base: Record<string, unknown> = {}
    if (trace.traceparent != null) {
      base._meta = { ...trace }
    }
    await this.#io.write({
      jsonrpc: '2.0',
      id,
      method: 'server/discover',
      params: protocol.decorateRequest(base, {
        capabilities: request.capabilities,
        clientInfo: request.clientInfo,
        logLevel: request.logLevel,
      }),
    } as ClientMessage)
    const deadline = this.#setupDeadline('server/discover')
    const message = await this.#readMatching(
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
    return { result: discovered.value, negotiatedRevision: protocol.version }
  }
}
