import { expect, test } from 'vitest'

import { schemaToFields } from '../src/flow/schema-fields.js'

test('maps primitives, required fields, defaults and string formats', () => {
  expect(
    schemaToFields({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          title: 'Name',
          description: 'Your name',
          default: 'Ada',
          format: 'email',
        },
        amount: { type: 'number' },
        count: { type: 'integer', default: 0 },
        enabled: { type: 'boolean', default: false },
      },
      required: ['name', 'enabled'],
    }),
  ).toEqual([
    {
      name: 'name',
      kind: 'text',
      title: 'Name',
      description: 'Your name',
      default: 'Ada',
      format: 'email',
      required: true,
    },
    { name: 'amount', kind: 'number', required: false },
    { name: 'count', kind: 'integer', default: 0, required: false },
    { name: 'enabled', kind: 'boolean', default: false, required: true },
  ])
})

test('maps enums and both titled enum encodings', () => {
  expect(
    schemaToFields({
      type: 'object',
      properties: {
        plain: { type: 'string', enum: ['a', 'b'] },
        named: { type: 'string', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] },
        titled: {
          type: 'string',
          oneOf: [
            { const: 'a', title: 'Alpha' },
            { const: 'b', title: 'Beta' },
          ],
        },
      },
    }),
  ).toEqual([
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
        { value: 'b', label: 'Beta' },
      ],
    },
  ])
})

test.each([
  { type: 'object', properties: { nested: { type: 'object' } } },
  { type: 'object', properties: { list: { type: 'array', items: { type: 'string' } } } },
  { type: 'object', properties: { value: { type: ['string', 'null'] } } },
  { type: 'object', properties: { value: { type: 'string', oneOf: [{ type: 'string' }] } } },
  { type: 'object', allOf: [] },
  null,
])('rejects schemas outside the elicitation subset: %j', (schema) => {
  expect(schemaToFields(schema)).toBeNull()
})
