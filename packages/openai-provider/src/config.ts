import { type FromSchema, type Schema, createValidator } from '@enkaku/schema'

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_TIMEOUT = 30_000

export const configurationSchema = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', description: 'OpenAI API key' },
    baseURL: { type: 'string', format: 'uri', description: 'Base URL of the OpenAI API' },
    timeout: {
      anyOf: [
        { type: 'integer', minimum: 0, description: 'Request timeout in milliseconds' },
        { type: 'boolean', const: false, description: 'No request timeout' },
      ],
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies Schema

export type OpenAIConfiguration = FromSchema<typeof configurationSchema>

export const validateConfiguration = createValidator(configurationSchema)
