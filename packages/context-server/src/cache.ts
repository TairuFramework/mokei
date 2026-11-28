import type { CacheHints } from './server.js'

/**
 * Methods whose `complete` results must carry caching hints on 2026-07-28
 * (specification/2026-07-28/server/utilities/caching).
 */
export const CACHEABLE_METHODS: ReadonlySet<string> = new Set([
  'server/discover',
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'resources/directory/read',
  'skills/list',
  'skills/get',
])

/** Conservative fallback: immediately stale, never shared between callers. */
export const DEFAULT_CACHE_HINTS: Required<CacheHints> = { ttlMs: 0, cacheScope: 'private' }

/**
 * Merges caching hints into a cacheable result, leaving hints the handler already set.
 * `extraMethods` adds methods to cache beyond {@link CACHEABLE_METHODS}, such as those of the
 * server's configured extensions.
 */
export function applyCacheHints(
  method: string,
  result: Record<string, unknown>,
  hints: CacheHints | undefined,
  extraMethods?: ReadonlySet<string>,
): Record<string, unknown> {
  if (!CACHEABLE_METHODS.has(method) && extraMethods?.has(method) !== true) {
    return result
  }
  return {
    ttlMs: hints?.ttlMs ?? DEFAULT_CACHE_HINTS.ttlMs,
    cacheScope: hints?.cacheScope ?? DEFAULT_CACHE_HINTS.cacheScope,
    ...result,
  }
}
