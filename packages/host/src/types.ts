import type {
  ContextTypes,
  ListParams,
  PayloadCapture,
  PromptParams,
  ToolParams,
  TraceParentFrom,
  UnknownContextTypes,
} from '@mokei/context-client'
import type {
  ElicitRequest,
  ElicitResult,
  Metadata,
  ProtocolVersion,
} from '@mokei/context-protocol'
import type { WithRequestOptions } from '@mokei/context-rpc'
import type { JSONValue, ServerConfig } from '@mokei/context-server'
import type { FetchMiddleware, HTTPAuthOptions, Runtime } from '@mokei/http-client'

import type { CreateHostedContextParams, HostedContext } from './hosted-context.js'
import type {
  ContextConnectivity,
  ContextFactory,
  ReconnectEvents,
  ReconnectOptions,
} from './reconnect.js'
import type { ContextTool, EnableToolsArg } from './tools.js'

export type ContextTransport = 'stdio' | 'http' | 'direct'

/**
 * Parameters for setting up a context: which tools to enable, plus the options for the
 * `tools/list` request the setup issues.
 */
export type SetupParams = ListParams<{
  key: string
  /** Which of the context's tools to enable. Defaults to all of them. */
  enableTools?: EnableToolsArg
}>

/** Parameters for replacing a context's tools wholesale. */
export type SetContextToolsParams = {
  key: string
  tools: Array<ContextTool>
}

/** Parameters for the tool-enablement methods, which act on a context's tools by name. */
export type ContextToolNamesParams = {
  key: string
  toolNames: Array<string>
}

/**
 * A per-call elicitation handler. On `2026-07-28` it answers the call's `elicitation/create` input
 * requests (MRTR, SEP-2322) ahead of any {@link ContextHost.handleElicitation} override; `fallback`
 * hands the request to the host-wide path. It never enables elicitation for a context added with
 * `elicit: false` or a host without elicitation. On `2025-11-25` it is ignored: a server-initiated
 * `elicitation/create` has no link to its call, so the host-wide path answers.
 */
export type PerCallElicit = { elicit?: HostElicitOverride }

/** Parameters for getting a prompt from a context, keyed by context. */
export type ContextPromptParams<T extends ContextTypes = UnknownContextTypes> = WithRequestOptions<
  PromptParams<T>
> &
  PerCallElicit & { key: string }

/** Parameters for calling a tool on a context, keyed by context. */
export type ContextToolParams<T extends ContextTypes = UnknownContextTypes> = WithRequestOptions<
  ToolParams<T>
> &
  PerCallElicit & { key: string }

/** Parameters for calling a tool by its namespaced ID (`contextKey:toolName` or `local:toolName`). */
export type NamespacedToolParams = WithRequestOptions<{
  id: string
  arguments?: Record<string, unknown>
  _meta?: Metadata
}> &
  PerCallElicit

/** Parameters for calling a local tool. Local tools run in-process, so they take no `timeout`. */
export type LocalToolParams = {
  name: string
  arguments?: Record<string, unknown>
  _meta?: Record<string, JSONValue>
  signal?: AbortSignal
  /** Attributes added to the `execute_tool` span; never sent anywhere else. */
  traceAttributes?: Record<string, string>
}

export type CreateContextParams = Omit<CreateHostedContextParams, 'elicit'> & {
  key: string
  elicit?: false
}

export type HostElicitRequest = {
  key: string
  params: ElicitRequest['params']
  signal: AbortSignal
}

export type HostElicitHandler = (request: HostElicitRequest) => ElicitResult | Promise<ElicitResult>

export type ElicitFallback = (options?: { signal?: AbortSignal }) => Promise<ElicitResult>

export type HostElicitOverride = (
  request: HostElicitRequest,
  fallback: ElicitFallback,
) => ElicitResult | Promise<ElicitResult>

export type ContextHostParams = {
  /** Subclass teardown, run after every context is removed. */
  dispose?: () => Promise<void>
  elicit?: HostElicitHandler | true
  /** MCP payload capture defaults to 'off'. */
  tracing?: { payloads?: PayloadCapture; parentFrom?: TraceParentFrom }
  /**
   * Reports whether the network is reachable. A reconnect waits while offline without spending
   * attempts; a missing or throwing hook counts as online.
   */
  connectivity?: ContextConnectivity
}

export type HasContextParams = { key: string }

/** Parameters of {@link ContextHost.subscribeResource} and `unsubscribeResource`. */
export type ContextResourceSubscriptionParams = {
  key: string
  uri: string
  /** Aborts the change before the server acknowledges it. */
  signal?: AbortSignal
}

export type RegisterHostedContextParams = {
  key: string
  context: HostedContext
  transport?: ContextTransport
  /** Rebuilds the context after a loss once `setup()` has run. Omit to remove it on loss. */
  reconnect?: { options: ReconnectOptions; factory: ContextFactory }
}

export type HostEvents = {
  'context:added': { key: string }
  'context:removed': { key: string }
  'context:failed': { key: string; error: Error }
  /** A reconnect attempt for a lost context is about to start. `error` is why the last one ended. */
  'context:reconnecting': ReconnectEvents['context:reconnecting']
  /** A lost context was rebuilt; `getContext(key).client` is the new client. */
  'context:reconnected': ReconnectEvents['context:reconnected']
  /** A resource subscription could not be restored after a reconnect and was dropped. */
  'resource:subscription-lost': { key: string; uri: string; error: Error }
  /**
   * A `2026-07-28` context's server signalled its tools list changed (SEP-1391). The host has
   * already re-listed the context and refreshed its namespaced tool aggregate before emitting.
   */
  'tools:changed': { key: string }
  /**
   * A `2026-07-28` context's server signalled its prompts list changed (SEP-1391). The host has
   * already re-listed the context's prompts before emitting.
   */
  'prompts:changed': { key: string }
  /**
   * A `2026-07-28` context's server signalled its resources list changed (SEP-1391). The host has
   * already re-listed the context's resources before emitting.
   */
  'resources:changed': { key: string }
  /**
   * A `2026-07-28` context's server signalled a subscribed resource's content changed (SEP-1391),
   * carrying the resource URI. The host forwards it as-is and does not re-read the resource --
   * reacting is the consumer's policy.
   */
  'resource:updated': { key: string; uri: string }
  /**
   * A `2025-11-25` context's server completed a URL-mode elicitation
   * (`notifications/elicitation/complete`). An application can close the matching URL prompt.
   */
  'elicitation:complete': { key: string; elicitationId: string }
}

export type AddDirectContextParams = {
  key: string
  config: ServerConfig
  tools?: Array<ContextTool>
  elicit?: false
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
  /**
   * Rebuild the context when its connection is lost, instead of removing it (`true` = defaults).
   * Applies once `setup()` has committed the context's tools. Clients returned by `add*Context`
   * or read from `getContext(key).client` earlier are not gated and go stale after a reconnect;
   * `getContext(key).client` always returns the current one.
   */
  reconnect?: boolean | ReconnectOptions
}

export type HTTPContextParams = {
  /** Unique identifier for this context */
  key: string
  elicit?: false
  /** URL of the MCP HTTP endpoint */
  url: string
  /** Optional custom headers to include in requests */
  headers?: Record<string, string>
  /** Optional authentication configuration */
  auth?: HTTPAuthOptions
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
  /** Fetch middleware (e.g. OAuth from createOAuthMiddleware) applied to the transport. */
  fetchMiddleware?: FetchMiddleware
  /**
   * Fetch and random-value implementations for the HTTP transport (default `createRuntime()`
   * from `@sozai/runtime`). React Native passes `@sozai/runtime-expo`'s `createRuntime({ fetch })`.
   */
  runtime?: Runtime
  /**
   * Rebuild the context when its connection is lost, instead of removing it (`true` = defaults):
   * a network failure, an expired session, or a GET stream that fails twice in a row. Each
   * attempt uses a new transport from these params, and never opens a sign-in: a server that
   * wants one ends the reconnect with `context:failed` (an `AuthRequiredError`).
   * Applies once `setup()` has committed the context's tools. Clients returned by `add*Context`
   * or read from `getContext(key).client` earlier are not gated and go stale after a reconnect;
   * `getContext(key).client` always returns the current one.
   */
  reconnect?: boolean | ReconnectOptions
}
