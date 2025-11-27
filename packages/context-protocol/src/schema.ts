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

// Single-select enum with optional default
export const enumSchema = {
  properties: {
    default: {
      type: 'string',
    },
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
      properties: {
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
        type: {
          const: 'string',
          type: 'string',
        },
      },
      required: ['enum', 'type'],
      type: 'object',
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
