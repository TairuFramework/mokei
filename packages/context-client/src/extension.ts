import type { ExtensionDefinition } from '@mokei/context-protocol'
import type { RequestOptions } from '@mokei/context-rpc'

import {
  type ContextClient,
  listPagedAccess,
  type PagedResult,
  requireExtensionAccess,
} from './client.js'
import type { ContextTypes, ListParams } from './types.js'

/**
 * Gates an extension method the way the client's own extension methods are gated: the client
 * must have enabled `definition` on a revision that carries it (else `MethodNotInRevisionError`,
 * nothing sent), and the server must have declared it (else `ExtensionNotDeclaredError`).
 * Returns the server's declared settings.
 *
 * @internal
 */
export function requireClientExtension<T extends ContextTypes>(
  client: ContextClient<T>,
  definition: ExtensionDefinition,
  method: string,
  options?: RequestOptions,
): Promise<Record<string, unknown>> {
  return requireExtensionAccess(client, definition, method, options)
}

/**
 * Walks a paginated list method with the client's own pager: every page is fetched and the
 * `key` arrays concatenated, unless `cursor` is set, in which case a single page is returned
 * verbatim. Honours `maxPages` and the client's `listMaxPages`.
 *
 * @internal
 */
export function listPaged<T extends ContextTypes>(
  client: ContextClient<T>,
  method: string,
  key: string,
  send: (params: Record<string, unknown>, options: RequestOptions) => Promise<PagedResult>,
  listParams: ListParams<Record<string, unknown>>,
): Promise<PagedResult> {
  return listPagedAccess(client, method, key, send, listParams)
}
