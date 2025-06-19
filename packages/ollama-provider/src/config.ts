import { createValidator, type FromSchema, type Schema } from '@enkaku/schema'

export const DEFAULT_BASE_URL = 'http://localhost:11434/api'
export const DEFAULT_TIMEOUT = 30_000

export const configurationSchema = {
  type: 'object',
  properties: {
    baseURL: { type: 'string', format: 'uri', description: 'Base URL of the Ollama server' },
    timeout: {
      anyOf: [
        { type: 'integer', minimum: 0, description: 'Request timeout in milliseconds' },
        { type: 'boolean', const: false, description: 'No request timeout' },
      ],
    },
  },
  additionalProperties: false,
} as const satisfies Schema
export type OllamaConfiguration = FromSchema<typeof configurationSchema>

export const validateConfiguration = createValidator(configurationSchema)
