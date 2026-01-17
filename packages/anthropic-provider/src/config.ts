import { createValidator, type FromSchema, type Schema } from '@enkaku/schema'

export const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'
export const DEFAULT_TIMEOUT = 60_000
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'

export const configurationSchema = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', description: 'Anthropic API key' },
    baseURL: { type: 'string', format: 'uri', description: 'Base URL of the Anthropic API' },
    timeout: {
      anyOf: [
        { type: 'integer', minimum: 0, description: 'Request timeout in milliseconds' },
        { type: 'boolean', const: false, description: 'No request timeout' },
      ],
    },
    anthropicVersion: {
      type: 'string',
      description: 'Anthropic API version header',
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies Schema

export type AnthropicConfiguration = FromSchema<typeof configurationSchema>

export const validateConfiguration = createValidator(configurationSchema)
