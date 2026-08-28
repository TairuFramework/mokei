import type { ProtocolVersion } from '@mokei/context-protocol'

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
 * protocol revision that can invoke it neither as a server-initiated request nor as an MRTR input
 * request — the client-side mirror of `@mokei/context-server`'s `MRTRNotSupportedError`.
 */
export class MRTRNotSupportedError extends Error {
  constructor(handler: string, version: ProtocolVersion) {
    super(
      `The "${handler}" handler is not supported on protocol version ${version}: the revision carries its method neither as a server-initiated request nor as a multi round-trip input request (MRTR, SEP-2322)`,
    )
    this.name = 'MRTRNotSupportedError'
  }
}

/**
 * Thrown when a server returns an `input_required` result the client will not fulfil: either
 * auto-fulfilment is off and the call did not pass `allowInputRequired`, or no handler is
 * configured for one of the embedded methods.
 */
export class InputRequiredNotSupportedError extends Error {
  constructor(reason: string) {
    super(`The server returned an "input_required" result: ${reason}`)
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
