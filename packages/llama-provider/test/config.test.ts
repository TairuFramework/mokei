import { describe, expect, test } from 'vitest'

import { type LlamaConfiguration, validateConfiguration } from '../src/config.js'

describe('validateConfiguration', () => {
  test('accepts valid config with models', () => {
    const config: LlamaConfiguration = {
      models: {
        'llama-3.2': { path: '/models/llama-3.2-3b.gguf' },
      },
    }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('accepts model with all options', () => {
    const config: LlamaConfiguration = {
      models: {
        'llama-3.2': {
          path: '/models/llama-3.2-3b.gguf',
          contextSize: 4096,
          gpu: 'auto',
        },
      },
    }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('accepts gpu as boolean', () => {
    const config: LlamaConfiguration = {
      models: {
        test: { path: '/models/test.gguf', gpu: true },
      },
    }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('accepts empty models', () => {
    const config: LlamaConfiguration = { models: {} }
    const result = validateConfiguration(config)
    expect(result.issues).toBeUndefined()
  })

  test('rejects config without models', () => {
    const result = validateConfiguration({})
    expect(result.issues).toBeDefined()
  })

  test('rejects model without path', () => {
    const result = validateConfiguration({ models: { test: {} } })
    expect(result.issues).toBeDefined()
  })
})

test('configurationSchema is exported from barrel', async () => {
  const barrel = await import('../src/index.js')
  expect(barrel.configurationSchema).toBeDefined()
  expect(barrel.configurationSchema.type).toBe('object')
})
