import { describe, expect, test } from 'vitest'

import { resolveSamplingParams } from '../src/index.js'

describe('resolveSamplingParams', () => {
  test('returns empty resolution when nothing provided', () => {
    const result = resolveSamplingParams()
    expect(result).toEqual({
      temperature: undefined,
      maxTokens: undefined,
      topP: undefined,
      providerOptions: undefined,
    })
  })

  test('typed per-request params override config defaults', () => {
    const result = resolveSamplingParams(
      { temperature: 0.2, topP: 0.9 },
      { temperature: 0.7, maxTokens: 4096, topP: 0.5 },
    )
    expect(result.temperature).toBe(0.2)
    expect(result.topP).toBe(0.9)
    expect(result.maxTokens).toBe(4096) // default kept when per-request unset
  })

  test('passes providerOptions through untouched (provider spreads it last)', () => {
    const result = resolveSamplingParams({
      temperature: 0.2,
      providerOptions: { seed: 42, temperature: 1 },
    })
    expect(result.providerOptions).toEqual({ seed: 42, temperature: 1 })
  })

  test('strips signal and stream from providerOptions, leaves other keys intact', () => {
    const result = resolveSamplingParams({
      providerOptions: { signal: new AbortController().signal, stream: false, seed: 7 },
    })
    expect(result.providerOptions).toEqual({ seed: 7 })
  })

  test('providerOptions bag with no transport keys is returned unchanged', () => {
    const result = resolveSamplingParams({
      providerOptions: { top_k: 5 },
    })
    expect(result.providerOptions).toEqual({ top_k: 5 })
  })

  test('undefined providerOptions returns undefined', () => {
    const result = resolveSamplingParams({ temperature: 0.5 })
    expect(result.providerOptions).toBeUndefined()
  })
})
