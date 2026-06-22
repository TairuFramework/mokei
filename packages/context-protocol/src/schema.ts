import type { FromSchema, Schema } from '@sozai/schema'

export const booleanSchema = {
  properties: {
    default: {
      type: 'boolean',
    },
    description: {
      type: 'string',
    },
    title: {
      type: 'string',
    },
    type: {
      const: 'boolean',
      type: 'string',
    },
  },
  required: ['type'],
  type: 'object',
} as const satisfies Schema

export const stringSchema = {
  properties: {
    default: {
      type: 'string',
    },
    description: {
      type: 'string',
    },
    format: {
      enum: ['date', 'date-time', 'email', 'uri'],
      type: 'string',
    },
    maxLength: {
      type: 'integer',
    },
    minLength: {
      type: 'integer',
    },
    pattern: {
      type: 'string',
    },
    title: {
      type: 'string',
    },
    type: {
      const: 'string',
      type: 'string',
    },
  },
  required: ['type'],
  type: 'object',
} as const satisfies Schema

export const numberSchema = {
  properties: {
    default: {
      type: 'number',
    },
    description: {
      type: 'string',
    },
    maximum: {
      type: 'number',
    },
    minimum: {
      type: 'number',
    },
    title: {
      type: 'string',
    },
    type: {
      enum: ['integer', 'number'],
      type: 'string',
    },
  },
  required: ['type'],
  type: 'object',
} as const satisfies Schema

// Single-select enum with optional default
export const enumSchema = {
  properties: {
    default: { type: 'string' },
    description: { type: 'string' },
    enum: { items: { type: 'string' }, type: 'array' },
    enumNames: { items: { type: 'string' }, type: 'array' },
    oneOf: {
      items: {
        properties: {
          const: { type: 'string' },
          description: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['const'],
        type: 'object',
      },
      type: 'array',
    },
    title: { type: 'string' },
    type: { const: 'string', type: 'string' },
  },
  required: ['type'],
  type: 'object',
} as const satisfies Schema

// Multi-select enum (array of strings)
export const multiSelectEnumSchema = {
  properties: {
    default: {
      items: {
        type: 'string',
      },
      type: 'array',
    },
    description: {
      type: 'string',
    },
    items: {
      anyOf: [
        {
          properties: {
            enum: { items: { type: 'string' }, type: 'array' },
            enumNames: { items: { type: 'string' }, type: 'array' },
            type: { const: 'string', type: 'string' },
          },
          required: ['enum', 'type'],
          type: 'object',
        },
        {
          properties: {
            anyOf: {
              items: {
                properties: {
                  const: { type: 'string' },
                  title: { type: 'string' },
                },
                required: ['const'],
                type: 'object',
              },
              type: 'array',
            },
          },
          required: ['anyOf'],
          type: 'object',
        },
      ],
    },
    title: {
      type: 'string',
    },
    type: {
      const: 'array',
      type: 'string',
    },
  },
  required: ['items', 'type'],
  type: 'object',
} as const satisfies Schema

export const primitiveSchemaDefinition = {
  anyOf: [stringSchema, numberSchema, booleanSchema, enumSchema, multiSelectEnumSchema],
  description:
    'Restricted schema definitions that only allow primitive types\nwithout nested objects or arrays.',
} as const satisfies Schema

export type PrimitiveSchemaDefinition = FromSchema<typeof primitiveSchemaDefinition>

/**
 * Infer the JSON Schema draft to validate a user-provided schema against, from its
 * `$schema` dialect URI. Defaults to draft-07; a schema declaring the 2020-12 dialect
 * opts into 2020-12 keywords (`$ref`, `prefixItems`, `unevaluatedProperties`, …).
 * Detecting from `$schema` keeps existing draft-07 schemas (the implicit default)
 * validating unchanged, so the relaxation is non-breaking.
 */
export function inferSchemaDraft(schema: Schema): '07' | '2020-12' {
  const declared = (schema as { $schema?: unknown }).$schema
  return typeof declared === 'string' && declared.includes('2020-12') ? '2020-12' : '07'
}
