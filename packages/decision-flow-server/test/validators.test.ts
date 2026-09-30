import { beforeEach, describe, expect, test } from 'vitest'

import {
  canonicalJSON,
  MAX_COMPILES,
  MAX_ENTRIES,
  resetValidatorCache,
  validatorCacheStats,
  validatorFor,
} from '../src/validators.js'

function numberSchema(index: number) {
  return {
    type: 'object' as const,
    properties: { [`field${index}`]: { type: 'number' as const } },
    required: [`field${index}`],
  }
}

beforeEach(() => {
  resetValidatorCache()
})

describe('validators', () => {
  test('canonicalJSON is independent of key order', () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, 1], c: null } })).toBe(
      canonicalJSON({ a: { c: null, d: [3, 1] }, b: 1 }),
    )
    expect(canonicalJSON({ a: [1, 2] })).not.toBe(canonicalJSON({ a: [2, 1] }))
    expect(canonicalJSON([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]')
  })

  test('identical schemas reuse one validator', () => {
    const schema = numberSchema(0)
    expect(validatorFor(schema)).toBe(validatorFor(structuredClone(schema)))
    expect(validatorCacheStats().compiles).toBe(1)
  })

  test('the 257th distinct compile recycles the factory', () => {
    for (let index = 0; index < MAX_COMPILES; index++) validatorFor(numberSchema(index))
    expect(validatorCacheStats()).toEqual({
      generation: 0,
      compiles: MAX_COMPILES,
      entries: MAX_ENTRIES,
    })
    validatorFor(numberSchema(MAX_COMPILES))
    expect(validatorCacheStats()).toEqual({ generation: 1, compiles: 1, entries: 1 })
  })

  test('a validator from a disposed factory still validates', () => {
    const validate = validatorFor(numberSchema(0))
    for (let index = 1; index <= MAX_COMPILES; index++) validatorFor(numberSchema(index))
    expect(validatorCacheStats().generation).toBe(1)
    expect(validate({ field0: 1 }).issues).toBeUndefined()
    expect(validate({ field0: 'bad' }).issues).toBeDefined()
  })

  test('LRU keeps at most 64 entries', () => {
    const first = validatorFor(numberSchema(0))
    for (let index = 1; index < MAX_ENTRIES; index++) validatorFor(numberSchema(index))
    // touch the oldest entry so it becomes the most recent
    expect(validatorFor(numberSchema(0))).toBe(first)
    validatorFor(numberSchema(MAX_ENTRIES))
    expect(validatorCacheStats()).toMatchObject({ compiles: MAX_ENTRIES + 1, entries: MAX_ENTRIES })
    // entry 0 survived, entry 1 was evicted
    expect(validatorFor(numberSchema(0))).toBe(first)
    expect(validatorCacheStats().compiles).toBe(MAX_ENTRIES + 1)
    validatorFor(numberSchema(1))
    expect(validatorCacheStats()).toMatchObject({ compiles: MAX_ENTRIES + 2, entries: MAX_ENTRIES })
  })
})
