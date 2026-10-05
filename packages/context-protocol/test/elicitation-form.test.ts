import { describe, expect, test } from 'vitest'

import { elicitFormFields } from '../src/index.js'

function form(property: unknown) {
  return { type: 'object', properties: { f: property } }
}

describe('elicitFormFields', () => {
  test('preserves declaration order, every kind and field metadata', () => {
    expect(
      elicitFormFields({
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: false },
          amount: { type: 'number', minimum: 0, maximum: 10 },
          count: { type: 'integer', default: 0 },
          name: {
            type: 'string',
            title: 'Name',
            description: 'Your name',
            default: 'Ada',
            format: 'email',
            pattern: '^.+$',
            minLength: 1,
            maxLength: 20,
          },
          plain: { type: 'string', enum: ['a', 'b'] },
          named: { type: 'string', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] },
          titled: { type: 'string', oneOf: [{ const: 'a', title: 'Alpha' }, { const: 'b' }] },
          many: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
          titledMany: {
            type: 'array',
            items: { anyOf: [{ const: 'a', title: 'Alpha' }, { const: 'b' }] },
          },
        },
        required: ['enabled', 'name'],
      }),
    ).toEqual({
      ok: true,
      fields: [
        { name: 'enabled', kind: 'boolean', required: true, default: false },
        { name: 'amount', kind: 'number', required: false, minimum: 0, maximum: 10 },
        { name: 'count', kind: 'integer', required: false, default: 0 },
        {
          name: 'name',
          kind: 'text',
          required: true,
          title: 'Name',
          description: 'Your name',
          default: 'Ada',
          format: 'email',
          pattern: '^.+$',
          minLength: 1,
          maxLength: 20,
        },
        {
          name: 'plain',
          kind: 'choice',
          required: false,
          choices: [
            { value: 'a', label: 'a' },
            { value: 'b', label: 'b' },
          ],
        },
        {
          name: 'named',
          kind: 'choice',
          required: false,
          choices: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ],
        },
        {
          name: 'titled',
          kind: 'choice',
          required: false,
          choices: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'b' },
          ],
        },
        {
          name: 'many',
          kind: 'multi',
          required: false,
          choices: [
            { value: 'a', label: 'a' },
            { value: 'b', label: 'b' },
          ],
        },
        {
          name: 'titledMany',
          kind: 'multi',
          required: false,
          choices: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'b' },
          ],
        },
      ],
    })
  })

  test('accepts an empty form', () => {
    expect(elicitFormFields({ type: 'object', properties: {} })).toEqual({ ok: true, fields: [] })
  })

  test.each(
    [
      null,
      true,
      [],
      { type: 'string' },
      { type: 'object' },
      { type: 'object', properties: [] },
    ].map((schema) => ({ schema })),
  )('rejects a non-object form: $schema', ({ schema }) => {
    expect(elicitFormFields(schema).ok).toBe(false)
  })

  test.each(['$ref', 'allOf', 'anyOf', 'oneOf', 'not'])('rejects top-level %s', (keyword) => {
    expect(elicitFormFields({ type: 'object', properties: {}, [keyword]: [] }).ok).toBe(false)
  })

  test.each(['$ref', 'allOf', 'anyOf', 'not'])('rejects property %s', (keyword) => {
    expect(elicitFormFields(form({ type: 'string', [keyword]: [] }))).toEqual({
      ok: false,
      reason: `property "f" has an unsupported ${keyword}`,
    })
  })

  test.each([null, 'f', [1], ['missing'], ['toString']].map((required) => ({ required })))(
    'rejects invalid required names: $required',
    ({ required }) => {
      expect(elicitFormFields({ ...form({ type: 'string' }), required }).ok).toBe(false)
    },
  )

  test('uses own property names for required, including __proto__', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}',
    )
    expect(elicitFormFields(schema)).toEqual({
      ok: true,
      fields: [{ name: '__proto__', kind: 'text', required: true }],
    })
  })

  test.each(
    [
      null,
      true,
      [],
      { type: 'object' },
      { type: ['string', 'null'] },
      { type: 'array', items: { type: 'string' } },
    ].map((property) => ({ property })),
  )('rejects unsupported properties: $property', ({ property }) => {
    expect(elicitFormFields(form(property))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^property "f" /),
    })
  })

  test.each([
    { type: 'string', enum: [] },
    { type: 'string', oneOf: [] },
    { type: 'array', items: { enum: [] } },
  ])('rejects empty choices: %j', (property) => {
    expect(elicitFormFields(form(property))).toEqual({
      ok: false,
      reason: 'property "f" has no choices',
    })
  })

  test.each([
    { type: 'string', enum: ['a', 'a'] },
    { type: 'string', enum: [''] },
    { type: 'string', enum: ['a', 'b'], enumNames: ['Same', 'Same'] },
    { type: 'string', enum: ['a'], enumNames: [''] },
    { type: 'string', oneOf: [{ const: 'a' }, { const: 'a' }] },
    { type: 'string', oneOf: [{ const: '' }] },
    { type: 'string', oneOf: [{ const: 'a', title: '' }] },
    { type: 'array', items: { enum: ['a', 'a'] } },
    { type: 'array', items: { anyOf: [{ const: '' }] } },
    {
      type: 'array',
      items: {
        anyOf: [
          { const: 'a', title: 'Same' },
          { const: 'b', title: 'Same' },
        ],
      },
    },
  ])('rejects duplicate or empty choice values or labels: %j', (property) => {
    expect(elicitFormFields(form(property))).toEqual({
      ok: false,
      reason: 'property "f" has duplicate or empty choice values or labels',
    })
  })

  test('rejects enumNames length mismatch with the desktop reason', () => {
    expect(elicitFormFields(form({ type: 'string', enum: ['a'], enumNames: ['A', 'B'] }))).toEqual({
      ok: false,
      reason: 'property "f" has an enumNames length different from its enum',
    })
  })

  test.each([
    { type: 'string', enum: [1] },
    { type: 'string', enum: 'a' },
    { type: 'string', enum: ['a'], enumNames: [1] },
    { type: 'string', enum: ['a'], enumNames: 'A' },
    { type: 'string', enum: ['a'], oneOf: [{ const: 'a' }] },
    { type: 'string', oneOf: [{ const: 1 }] },
    { type: 'string', oneOf: [null] },
    { type: 'string', oneOf: [{ const: 'a', title: 1 }] },
    { type: 'string', oneOf: [{ const: 'a', allOf: [] }] },
    { type: 'number', oneOf: [{ const: 'a' }] },
    { type: 'boolean', enum: [true] },
    { type: 'string', const: 'a' },
    { type: 'array', items: { enum: [1] } },
    { type: 'array', items: { anyOf: [{ const: 1 }] } },
    { type: 'array', items: { enum: ['a'], anyOf: [{ const: 'a' }] } },
    { type: 'array', items: { type: 'number', enum: ['a'] } },
    { type: 'array', items: { $ref: '#x', enum: ['a'] } },
  ])('rejects malformed or conflicting choices: %j', (property) => {
    expect(elicitFormFields(form(property))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^property "f" /),
    })
  })

  test.each(['(', '\\a', 1])('rejects invalid Unicode patterns: %j', (pattern) => {
    expect(elicitFormFields(form({ type: 'string', pattern }))).toEqual({
      ok: false,
      reason: 'property "f" has an invalid pattern',
    })
  })

  test('validates patterns even on choice fields', () => {
    expect(elicitFormFields(form({ type: 'string', enum: ['a'], pattern: '(' }))).toEqual({
      ok: false,
      reason: 'property "f" has an invalid pattern',
    })
  })
})
