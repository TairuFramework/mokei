import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { buildChat, resolveApiKey } from '../../src/chat/providers.js'

describe('resolveApiKey', () => {
  let saved: NodeJS.ProcessEnv

  beforeEach(() => {
    saved = process.env
    process.env = { ...saved }
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    process.env = saved
  })

  test('an explicit key takes precedence over the env var', () => {
    process.env.OPENAI_API_KEY = 'from-env'
    expect(resolveApiKey('openai', 'explicit')).toBe('explicit')
  })

  test('openai falls back to OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'env-openai'
    expect(resolveApiKey('openai')).toBe('env-openai')
  })

  test('anthropic falls back to ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'env-anthropic'
    expect(resolveApiKey('anthropic')).toBe('env-anthropic')
  })

  test('ollama has no api key', () => {
    expect(resolveApiKey('ollama')).toBeUndefined()
  })
})

describe('buildChat', () => {
  test('rejects an unknown provider before touching the daemon', async () => {
    await expect(buildChat('bogus', {})).rejects.toThrow('unknown provider')
  })
})
