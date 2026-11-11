import { createValidatorCache, type Schema, type Validator } from '@sozai/schema'

/** Distinct compiles on one factory before it is disposed and replaced. */
export const MAX_COMPILES = 256
/** Validators kept in the least recently used cache. */
export const MAX_ENTRIES = 64

const cache = createValidatorCache({ maxCompiles: MAX_COMPILES, maxEntries: MAX_ENTRIES })

/**
 * Validator for a runtime schema, compiled on an isolated factory. The factory is recycled after
 * MAX_COMPILES distinct compiles; validators handed out earlier keep working.
 */
export function validatorFor(schema: Schema): Validator<unknown> {
  return cache.get<Schema, unknown>(schema)
}

export function validatorCacheStats(): { generation: number; compiles: number; entries: number } {
  return cache.stats()
}

/** Reset the cache and factory. Tests only. */
export function resetValidatorCache(): void {
  cache.clear()
}
