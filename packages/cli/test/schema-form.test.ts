import type { ElicitFormField } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import {
  parseElicitationForm,
  UnsupportedSchemaError,
  validateFieldInput,
} from '../src/prompts/schema-form.js'

describe('parseElicitationForm', () => {
  test('keeps declaration order and marks required fields', () => {
    const fields = parseElicitationForm({
      type: 'object',
      properties: {
        b: { type: 'string', title: 'B field' },
        a: { type: 'boolean', default: true },
        n: { type: 'number', minimum: 1, maximum: 9 },
        i: { type: 'integer' },
      },
      required: ['a'],
    })
    expect(fields.map((f) => f.name)).toEqual(['b', 'a', 'n', 'i'])
    expect(fields.map((f) => f.kind)).toEqual(['text', 'boolean', 'number', 'integer'])
    expect(fields.map((f) => f.required)).toEqual([false, true, false, false])
    expect(fields[0]?.title).toBe('B field')
    expect(fields[1]?.default).toBe(true)
    expect(fields[2]).toMatchObject({ minimum: 1, maximum: 9 })
  })

  test('maps enum + enumNames and oneOf titles to choices', () => {
    const fields = parseElicitationForm({
      type: 'object',
      properties: {
        e: { type: 'string', enum: ['x', 'y'], enumNames: ['Ex', 'Why'] },
        p: { type: 'string', enum: ['q'] },
        o: { type: 'string', oneOf: [{ const: 'r', title: 'Are' }, { const: 's' }] },
      },
    })
    expect(fields[0]).toMatchObject({
      kind: 'choice',
      choices: [
        { label: 'Ex', value: 'x' },
        { label: 'Why', value: 'y' },
      ],
    })
    expect(fields[1]?.choices).toEqual([{ label: 'q', value: 'q' }])
    expect(fields[2]?.choices).toEqual([
      { label: 'Are', value: 'r' },
      { label: 's', value: 's' },
    ])
  })

  test('rejects non-object schemas and non-primitive properties', () => {
    expect(() => parseElicitationForm({ type: 'string' })).toThrow(UnsupportedSchemaError)
    expect(() => parseElicitationForm({ type: 'string' })).toThrow(/--value/)
    expect(() =>
      parseElicitationForm({ type: 'object', properties: { o: { type: 'object' } } }),
    ).toThrow(/--value/)
  })
})

const field = (overrides: Partial<ElicitFormField>): ElicitFormField => ({
  name: 'k',
  kind: 'text',
  required: false,
  ...overrides,
})

describe('validateFieldInput', () => {
  test('number parsing and bounds', () => {
    expect(validateFieldInput(field({ kind: 'number' }), 'abc').error).toBeDefined()
    expect(validateFieldInput(field({ kind: 'number' }), '2.5').value).toBe(2.5)
    expect(validateFieldInput(field({ kind: 'number', maximum: 3 }), '5').error).toBeDefined()
    expect(validateFieldInput(field({ kind: 'number', minimum: 3 }), '1').error).toBeDefined()
    expect(validateFieldInput(field({ kind: 'integer' }), '2.5').error).toBeDefined()
    expect(validateFieldInput(field({ kind: 'integer' }), '4').value).toBe(4)
  })

  test('whitespace-only number is rejected', () => {
    expect(validateFieldInput(field({ kind: 'number' }), '  ').error).toBeDefined()
  })

  test('string length counts code points', () => {
    expect(validateFieldInput(field({ maxLength: 1 }), '😀').value).toBe('😀')
  })

  test('string length bounds', () => {
    expect(validateFieldInput(field({ minLength: 3 }), 'ab').error).toBeDefined()
    expect(validateFieldInput(field({ maxLength: 2 }), 'abc').error).toBeDefined()
    expect(validateFieldInput(field({ maxLength: 3 }), 'abc').value).toBe('abc')
  })

  test('empty input: skip, error or default', () => {
    expect(validateFieldInput(field({}), '')).toEqual({ skip: true })
    expect(validateFieldInput(field({ required: true }), '').error).toBeDefined()
    expect(validateFieldInput(field({ default: 'd' }), '').value).toBe('d')
    expect(validateFieldInput(field({ kind: 'number', default: 7 }), '').value).toBe(7)
  })
})
