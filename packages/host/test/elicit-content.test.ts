import { beforeEach, describe, expect, test } from 'vitest'

import {
  createElicitContentValidator,
  elicitValidatorStats,
  type RequestedSchema,
  resetElicitValidators,
  validateElicitContent,
} from '../src/elicit-content.js'

function schema(properties: Record<string, unknown>, required?: Array<string>): RequestedSchema {
  return { type: 'object', properties, required } as RequestedSchema
}

beforeEach(() => resetElicitValidators())

describe('elicitation content validation', () => {
  const requestedSchema = schema(
    {
      s: { type: 'string', minLength: 2 },
      n: { type: 'integer', minimum: 1 },
      b: { type: 'boolean' },
      e: { type: 'string', enum: ['a', 'b'] },
      o: { type: 'string', oneOf: [{ const: 'x' }, { const: 'y' }] },
      m1: { type: 'array', items: { type: 'string', enum: ['p', 'q'] } },
      m2: { type: 'array', items: { anyOf: [{ const: 'p' }, { const: 'q', title: 'Q' }] } },
    },
    ['s'],
  )

  test('valid content', () => {
    expect(
      validateElicitContent(requestedSchema, {
        s: 'ok',
        n: 2,
        b: true,
        e: 'a',
        o: 'y',
        m1: ['p'],
        m2: ['q', 'p'],
      }),
    ).toEqual([])
    expect(validateElicitContent(requestedSchema, { s: 'ok' })).toEqual([])
  })

  test('non-object content', () => {
    expect(validateElicitContent(requestedSchema, null)).toEqual(['content must be an object'])
    expect(validateElicitContent(requestedSchema, [])).toEqual(['content must be an object'])
  })

  test('unknown key and missing required', () => {
    expect(validateElicitContent(requestedSchema, { s: 'ok', extra: 1 })).toEqual([
      'extra: unknown property',
    ])
    expect(validateElicitContent(requestedSchema, {})).toEqual(['s: required'])
  })

  test('types, enums, constraints and multi-select issues name their property', () => {
    expect(validateElicitContent(requestedSchema, { s: 1 })).toEqual(['s: must be a string'])
    expect(validateElicitContent(requestedSchema, { s: 'x' })).toEqual([
      's: must be at least 2 characters',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', n: '2' })).toEqual([
      'n: must be a whole number',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', b: 'true' })).toEqual([
      'b: must be a boolean',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', n: Number.NaN })).toEqual([
      'n: must be a whole number',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', e: 'z' })).toEqual([
      'e: must be one of the offered choices',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', o: 'z' })).toEqual([
      'o: must be one of the offered choices',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', m1: ['p', 'z'] })).toEqual([
      'm1: "z" is not an offered choice',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', m2: ['z'] })).toEqual([
      'm2: "z" is not an offered choice',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', m1: 'p' })).toEqual([
      'm1: must be an array of strings',
    ])
    expect(validateElicitContent(requestedSchema, { s: 'ok', m1: [1] })).toEqual([
      'm1: must be an array of strings',
    ])
  })

  test('string lengths count code points', () => {
    const requestedSchema = schema({ s: { type: 'string', maxLength: 1 } })
    expect(validateElicitContent(requestedSchema, { s: '\u{1F600}' })).toEqual([])
  })

  test('a declared $schema does not change the validation dialect', () => {
    const requestedSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...schema({ s: { type: 'string', minLength: 2 } }),
    } as RequestedSchema
    expect(validateElicitContent(requestedSchema, { s: 'ok' })).toEqual([])
    expect(validateElicitContent(requestedSchema, { s: 'x' })).toEqual([
      's: must be at least 2 characters',
    ])
  })

  test('an uncompilable schema reports one issue instead of throwing', () => {
    const issues = validateElicitContent(schema({ s: { type: 'string', pattern: '(' } }), {
      s: 'x',
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^the requested schema cannot be validated: /)
  })

  test('undefined properties are treated as absent', () => {
    expect(validateElicitContent(requestedSchema, { s: 'ok', e: undefined })).toEqual([])
  })

  test('a property named __proto__ remains an ordinary requested property', () => {
    const requestedSchema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"b":{"type":"string"}}}',
    ) as RequestedSchema
    const value = JSON.parse('{"__proto__":"a","b":"x"}')
    expect(validateElicitContent(requestedSchema, value)).toEqual(['__proto__: unknown property'])
  })

  test('a non-string required entry does not hide string requirements', () => {
    const malformed = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 5],
    } as unknown as RequestedSchema
    expect(validateElicitContent(malformed, {})).not.toEqual([])
  })

  test('whitelisted keyword values with a wrong type are ignored', () => {
    expect(
      validateElicitContent(schema({ s: { type: 'string', minLength: 'x' } }), { s: 'a' }),
    ).toEqual([])
  })

  test('non-whitelisted schema keywords are dropped', () => {
    for (const extra of [
      { $ref: 'https://evil.example/x' },
      { not: { type: 'string' } },
      { allOf: [{ maxLength: 0 }] },
      // biome-ignore lint/suspicious/noThenProperty: a JSON Schema if/then, not a thenable
      { if: { type: 'string' }, then: { maxLength: 0 } },
      { const: 'nope' },
      { $id: 'http://x/y' },
    ]) {
      expect(
        validateElicitContent(schema({ s: { type: 'string', ...extra } }), { s: 'a' }),
      ).toEqual([])
    }
  })

  test('multi-select constraints use choice messages', () => {
    const content = (extra: Record<string, unknown>, value: unknown) =>
      validateElicitContent(
        schema({ m: { type: 'array', items: { enum: ['x', 'y'] }, ...extra } }),
        { m: value },
      )
    expect(content({ minItems: 1 }, [])).toEqual(['m: choose at least 1 option'])
    expect(content({ minItems: 2 }, ['x'])).toEqual(['m: choose at least 2 options'])
    expect(content({ maxItems: 1 }, ['x', 'y'])).toEqual(['m: choose at most 1 option'])
    expect(content({ uniqueItems: true }, ['x', 'x'])).toEqual(['m: choose each option only once'])
  })
})

describe('compiled elicitation validator cache', () => {
  test('identical schemas in fresh objects reuse one compile', () => {
    const requestedSchema = schema({ s: { type: 'string', maxLength: 100 } })
    validateElicitContent(requestedSchema, { s: 'a' })
    validateElicitContent(
      { ...requestedSchema, properties: { ...requestedSchema.properties } },
      { s: 'a' },
    )
    expect(elicitValidatorStats().compiles).toBe(1)
  })

  test('the cache is bounded', () => {
    for (let index = 0; index < 65; index++) {
      validateElicitContent(schema({ s: { type: 'string', maxLength: index + 100 } }), { s: 'a' })
    }
    expect(elicitValidatorStats().entries).toBe(64)
  })

  test('reset clears stats and compiled entries', () => {
    validateElicitContent(schema({ s: { type: 'string' } }), { s: 'a' })
    resetElicitValidators()
    expect(elicitValidatorStats()).toEqual({ generation: 0, compiles: 0, entries: 0 })
  })

  test('a validator obtained before factory recycle still validates', () => {
    const validator = createElicitContentValidator(schema({ s: { type: 'string', maxLength: 1 } }))
    for (let index = 0; index < 257; index++) {
      validateElicitContent(schema({ s: { type: 'string', maxLength: index + 10 } }), { s: 'a' })
    }
    expect(elicitValidatorStats().generation).toBe(1)
    expect(validator({ s: 'xx' })).toEqual(['s: must be at most 1 character'])
  })
})
