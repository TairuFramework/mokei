import { createValidator, type FromSchema, type Schema } from '@sozai/schema'

const llamaModelConfigSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to .gguf model file' },
    contextSize: { type: 'integer', minimum: 1, description: 'Default context size' },
    gpu: {
      anyOf: [{ type: 'boolean' }, { type: 'string', const: 'auto' }],
      description: 'GPU offloading preference',
    },
  },
  required: ['path'],
  additionalProperties: false,
} as const satisfies Schema

export type LlamaModelConfig = FromSchema<typeof llamaModelConfigSchema>

export const configurationSchema = {
  type: 'object',
  properties: {
    models: {
      type: 'object',
      additionalProperties: llamaModelConfigSchema,
      description: 'Model name to configuration mapping',
    },
  },
  required: ['models'],
  additionalProperties: false,
} as const satisfies Schema

export type LlamaConfiguration = FromSchema<typeof configurationSchema>

export const validateConfiguration = createValidator(configurationSchema)
