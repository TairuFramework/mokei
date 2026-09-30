import {
  createValidatorFactory,
  type Schema,
  type Validator,
  type ValidatorFactory,
} from '@sozai/schema'

/** Distinct compiles on one factory before it is disposed and replaced. */
export const MAX_COMPILES = 256
/** Validators kept in the least recently used cache. */
export const MAX_ENTRIES = 64

/** JSON with object keys sorted recursively; array order is kept. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    )
  })
}

let factory: ValidatorFactory | undefined
let generation = 0
let compiles = 0
const cache = new Map<string, Validator<unknown>>()

/**
 * Validator for a runtime schema, compiled on an isolated factory. The factory is recycled after
 * MAX_COMPILES distinct compiles; validators handed out earlier keep working.
 */
export function validatorFor(schema: Schema): Validator<unknown> {
  const key = canonicalJSON(schema)
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  if (factory !== undefined && compiles >= MAX_COMPILES) {
    factory.dispose()
    factory = undefined
    cache.clear()
    compiles = 0
    generation += 1
  }
  factory ??= createValidatorFactory()
  const validator = factory.createValidator(schema) as Validator<unknown>
  compiles += 1
  cache.set(key, validator)
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return validator
}

export function validatorCacheStats(): { generation: number; compiles: number; entries: number } {
  return { generation, compiles, entries: cache.size }
}

/** Reset the cache and factory. Tests only. */
export function resetValidatorCache(): void {
  factory?.dispose()
  factory = undefined
  generation = 0
  compiles = 0
  cache.clear()
}
