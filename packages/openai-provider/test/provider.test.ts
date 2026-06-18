import { describe, expect, test } from 'vitest'
import { DEFAULT_TIMEOUT as ANTHROPIC_DEFAULT_TIMEOUT } from '../../anthropic-provider/src/config.js'
import { DEFAULT_TIMEOUT } from '../src/config.js'
import { OpenAIProvider } from '../src/provider.js'

describe('OpenAIProvider construction', () => {
  test('constructs with no arguments', () => {
    const provider = new OpenAIProvider()
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  test('default timeout is standardized to 30s across providers', () => {
    expect(DEFAULT_TIMEOUT).toBe(30_000)
    expect(ANTHROPIC_DEFAULT_TIMEOUT).toBe(30_000)
  })
})
