import type { ExtensionDefinition, ReadResourceResult } from '@mokei/context-protocol'

import type { CacheHints } from './server.js'
import type { HandlerRequest, ServerClient } from './types.js'

/**
 * The request an extension method handler receives.
 *
 * @internal
 */
export type ExtensionHandlerRequest = HandlerRequest<{
  client: ServerClient
  params: Record<string, unknown>
}>

/**
 * Answers one extension client method. The returned body is wrapped and given cache hints by the
 * server like any core result.
 *
 * @internal
 */
export type ExtensionMethodHandler = (
  request: ExtensionHandlerRequest,
) => unknown | Promise<unknown>

/**
 * Serves `resources/read` for the URIs it owns, on every revision the server speaks.
 *
 * @internal
 */
export type ResourceProvider = {
  /** Must be cheap and pure: it may be called several times per request. */
  owns(uri: string): boolean
  /** Throws an `RPCError` with `INVALID_PARAMS` when the URI is owned but not found. */
  read(uri: string): ReadResourceResult['contents'][number]
}

/**
 * An extension served by a `ContextServer`, matched to the extension registry by
 * `definition.id`.
 *
 * - `handlers` answer the extension's client methods; a method of the definition without a
 *   handler is `METHOD_NOT_FOUND`.
 * - `resources` answers `resources/read` for the URIs it owns, ahead of the server's own handler.
 * - `resources` needs `capabilities: { resources: true }` for the server to declare `resources`.
 * - `capabilities.resources` declares `resources: {}` when the server has no `resources`, which
 *   then answers empty list pages and `Resource not found` for URIs no provider owns.
 * - `cache` and `scopes` replace the server's for the extension's requests: its methods and the
 *   `resources/read` of a URI it owns. An unset `cache` field falls back to the server's; unset
 *   `scopes` means none.
 *
 * @internal
 */
export type ServerExtension = {
  definition: ExtensionDefinition
  settings?: Record<string, unknown>
  handlers: Partial<Record<string, ExtensionMethodHandler>>
  resources?: ResourceProvider
  capabilities?: { resources?: true }
  cache?: CacheHints
  scopes?: ReadonlyArray<string>
}
