import { describe, expect, test } from 'vitest'

import {
  type Schema,
  StructuredOutputError,
  type StructuredOutputParams,
  validateWithSchema,
} from '../src/index.js'

describe('structured output', () => {
  describe('validateWithSchema', () => {
    test('validates valid object against schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      } as const satisfies Schema

      const result = validateWithSchema(schema, { name: 'Alice', age: 30 })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Alice')
        expect(result.data.age).toBe(30)
      }
    })

    test('returns error for invalid object', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      } as const satisfies Schema

      const result = validateWithSchema(schema, { name: 123 })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(StructuredOutputError)
        expect(result.error.issues.length).toBeGreaterThan(0)
      }
    })

    test('returns error for missing required field', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'email'],
      } as const satisfies Schema

      const result = validateWithSchema(schema, { name: 'Bob' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(StructuredOutputError)
      }
    })

    test('validates nested object', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              settings: {
                type: 'object',
                properties: {
                  theme: { type: 'string' },
                },
              },
            },
          },
        },
      } as const satisfies Schema

      const result = validateWithSchema(schema, {
        user: {
          name: 'Alice',
          settings: { theme: 'dark' },
        },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.user?.name).toBe('Alice')
        expect(result.data.user?.settings?.theme).toBe('dark')
      }
    })

    test('validates array', () => {
      const schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      } as const satisfies Schema

      const result = validateWithSchema(schema, { items: ['a', 'b', 'c'] })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.items).toEqual(['a', 'b', 'c'])
      }
    })

    test('validates enum', () => {
      const schema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'active', 'completed'] },
        },
      } as const satisfies Schema

      const validResult = validateWithSchema(schema, { status: 'active' })
      expect(validResult.success).toBe(true)

      const invalidResult = validateWithSchema(schema, { status: 'unknown' })
      expect(invalidResult.success).toBe(false)
    })
  })

  describe('StructuredOutputError', () => {
    test('has correct name and issues', () => {
      const error = new StructuredOutputError('Test error', [
        { message: 'Field is required', path: ['name'] },
        { message: 'Must be a number', path: ['age'] },
      ])

      expect(error.name).toBe('StructuredOutputError')
      expect(error.message).toBe('Test error')
      expect(error.issues).toHaveLength(2)
      expect(error.issues[0].message).toBe('Field is required')
      expect(error.issues[0].path).toEqual(['name'])
    })
  })

  describe('StructuredOutputParams', () => {
    test('type is correctly defined', () => {
      const params: StructuredOutputParams = {
        schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
          },
        },
        name: 'response',
        description: 'The structured response',
        strict: true,
      }

      expect(params.schema.type).toBe('object')
      expect(params.name).toBe('response')
      expect(params.strict).toBe(true)
    })
  })
})
