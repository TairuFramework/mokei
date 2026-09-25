import type { ProtocolVersion } from '@mokei/context-protocol'

export type UnsupportedProtocolVersionErrorParams = {
  received: string
  expected?: ProtocolVersion
  cause?: unknown
}

export class UnsupportedProtocolVersionError extends Error {
  /**
   * `expected` is only known when this is raised against a server's handshake response (the
   * negotiated version has to match the one the client asked for). A rejected config-time pin
   * (`ClientParams.protocolVersion`) has no single "expected" value to name, so it's omitted
   * there and the message drops the clause instead of naming an arbitrary revision.
   */
  constructor(params: UnsupportedProtocolVersionErrorParams) {
    super(
      params.expected == null
        ? `Unsupported protocolVersion "${params.received}"`
        : `Server responded with unsupported protocolVersion "${params.received}"; expected "${params.expected}"`,
      { cause: params.cause },
    )
    this.name = 'UnsupportedProtocolVersionError'
  }
}

export class CapabilityNotDeclaredError extends Error {
  constructor(params: CapabilityNotDeclaredErrorParams) {
    super(`Server did not declare the "${params.capability}" capability`, { cause: params.cause })
    this.name = 'CapabilityNotDeclaredError'
  }
}

export type CapabilityNotDeclaredErrorParams = { capability: string; cause?: unknown }

/**
 * Thrown when a method is absent from a protocol revision's `clientMethods` -- derived from that
 * table, not a version literal, so this fires exactly when the method itself is gone (as
 * opposed to, say, a rejected parameter value).
 *
 * `request()` throws it for any method at all, which is what covers a caller reaching past the
 * typed wrappers. `setLoggingLevel()` throws it earlier, before its capability check, and passes
 * `hint` to say where the log level went on `2026-07-28`.
 */
export class MethodNotInRevisionError extends Error {
  constructor(params: MethodNotInRevisionErrorParams) {
    super(
      `${params.method} does not exist in protocol version ${params.version}${params.hint == null ? '' : `: ${params.hint}`}`,
      { cause: params.cause },
    )
    this.name = 'MethodNotInRevisionError'
  }
}

export type MethodNotInRevisionErrorParams = {
  method: string
  version: ProtocolVersion
  hint?: string
  cause?: unknown
}

/**
 * Thrown when a client is configured with a `createMessage`/`elicit`/`listRoots` handler on a
 * protocol revision that can invoke it neither as a server-initiated request nor as an MRTR input
 * request -- the client-side mirror of `@mokei/context-server`'s `MRTRNotSupportedError`.
 */
export class MRTRNotSupportedError extends Error {
  constructor(params: MRTRNotSupportedErrorParams) {
    super(
      `The "${params.handler}" handler is not supported on protocol version ${params.version}: the revision carries its method neither as a server-initiated request nor as a multi round-trip input request (MRTR, SEP-2322)`,
      { cause: params.cause },
    )
    this.name = 'MRTRNotSupportedError'
  }
}

export type MRTRNotSupportedErrorParams = {
  handler: string
  version: ProtocolVersion
  cause?: unknown
}

/**
 * Thrown when a server returns an `input_required` result the client will not fulfil: either
 * auto-fulfilment is off and the call did not pass `allowInputRequired`, or no handler is
 * configured for one of the embedded methods.
 */
export class InputRequiredNotSupportedError extends Error {
  constructor(params: InputRequiredNotSupportedErrorParams) {
    super(`The server returned an "input_required" result: ${params.reason}`, {
      cause: params.cause,
    })
    this.name = 'InputRequiredNotSupportedError'
  }
}

export type InputRequiredNotSupportedErrorParams = { reason: string; cause?: unknown }

/** Thrown when a paginated list walk fetches more pages than its cap allows. */
export class ListMaxPagesError extends Error {
  /** The list method that exceeded the cap, e.g. `tools/list`. */
  #method: string
  /** Number of pages fetched before giving up. */
  #pages: number
  /** Cursor of the page that would have been fetched next. */
  #cursor: string
  /** Items collected across the pages that were fetched. */
  #results: Array<unknown>

  constructor(params: ListMaxPagesErrorParams) {
    super(`Listing ${params.method} exceeded the maximum of ${params.pages} pages`, {
      cause: params.cause,
    })
    this.name = 'ListMaxPagesError'
    this.#method = params.method
    this.#pages = params.pages
    this.#cursor = params.cursor
    this.#results = params.results
  }

  get method(): string {
    return this.#method
  }
  get pages(): number {
    return this.#pages
  }
  get cursor(): string {
    return this.#cursor
  }
  get results(): Array<unknown> {
    return this.#results
  }
}

export type ListMaxPagesErrorParams = {
  method: string
  pages: number
  cursor: string
  results: Array<unknown>
  cause?: unknown
}

/** A validation issue, matching the shape `createTool` produces for input errors. */
export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<PropertyKey>
}

/** Thrown when a tool result's structuredContent violates the tool's advertised outputSchema. */
export class StructuredContentValidationError extends Error {
  #toolName: string
  #issues: Array<ValidationIssue>

  constructor(params: StructuredContentValidationErrorParams) {
    super(`Invalid structuredContent returned by tool ${params.toolName}`, { cause: params.cause })
    this.name = 'StructuredContentValidationError'
    this.#toolName = params.toolName
    this.#issues = params.issues
  }

  get toolName(): string {
    return this.#toolName
  }
  get issues(): Array<ValidationIssue> {
    return this.#issues
  }
}

export type StructuredContentValidationErrorParams = {
  toolName: string
  issues: Array<ValidationIssue>
  cause?: unknown
}
