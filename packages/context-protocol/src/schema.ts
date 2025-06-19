import type { FromSchema, Schema } from '@enkaku/schema'

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
    description: {
      type: 'string',
    },
    maximum: {
      type: 'integer',
    },
    minimum: {
      type: 'integer',
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

export const enumSchema = {
  properties: {
    description: {
      type: 'string',
    },
    enum: {
      items: {
        type: 'string',
      },
      type: 'array',
    },
    enumNames: {
      items: {
        type: 'string',
      },
      type: 'array',
    },
    title: {
      type: 'string',
    },
    type: {
      const: 'string',
      type: 'string',
    },
  },
  required: ['enum', 'type'],
  type: 'object',
} as const satisfies Schema

export const primitiveSchemaDefinition = {
  anyOf: [stringSchema, numberSchema, booleanSchema, enumSchema],
  description:
    'Restricted schema definitions that only allow primitive types\nwithout nested objects or arrays.',
} as const satisfies Schema

export type PrimitiveSchemaDefinition = FromSchema<typeof primitiveSchemaDefinition>
