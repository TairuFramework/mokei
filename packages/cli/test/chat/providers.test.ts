import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { buildChat, llamaModelName, resolveApiKey } from '../../src/chat/providers.js'

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

  test('rejects an unknown provider before touching the daemon', async () => {
    await expect(buildChat('bogus', {})).rejects.toThrow('unknown provider')
  })

  test('fails fast when openai has no API key', async () => {
    await expect(buildChat('openai', {})).rejects.toThrow(/set OPENAI_API_KEY/)
  })

  test('fails fast when anthropic has no API key', async () => {
    await expect(buildChat('anthropic', {})).rejects.toThrow(/set ANTHROPIC_API_KEY/)
  })

  test('llama needs no API key but rejects a missing model path', async () => {
    await expect(buildChat('llama', {})).rejects.toThrow(/--model/)
  })

  test('llama rejects an empty model path', async () => {
    await expect(buildChat('llama', { model: '' })).rejects.toThrow(/--model/)
  })
})

describe('llamaModelName', () => {
  test('strips the directory and .gguf extension', () => {
    expect(llamaModelName('/models/qwen2.5-7b-instruct-q4.gguf')).toBe('qwen2.5-7b-instruct-q4')
  })

  test('keeps a name that has no .gguf extension', () => {
    expect(llamaModelName('/models/plain-name')).toBe('plain-name')
  })

  test('handles a bare filename', () => {
    expect(llamaModelName('model.gguf')).toBe('model')
  })
})
