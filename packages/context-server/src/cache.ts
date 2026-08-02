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
])

/** Conservative fallback: immediately stale, never shared between callers. */
export const DEFAULT_CACHE_HINTS: Required<CacheHints> = { ttlMs: 0, cacheScope: 'private' }

/** Merges caching hints into a cacheable result, leaving hints the handler already set. */
export function applyCacheHints(
  method: string,
  result: Record<string, unknown>,
  hints: CacheHints | undefined,
): Record<string, unknown> {
  if (!CACHEABLE_METHODS.has(method)) {
    return result
  }
  return {
    ttlMs: hints?.ttlMs ?? DEFAULT_CACHE_HINTS.ttlMs,
    cacheScope: hints?.cacheScope ?? DEFAULT_CACHE_HINTS.cacheScope,
    ...result,
  }
}
