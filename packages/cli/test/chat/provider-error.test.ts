import { ProviderError } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { describeProviderError, retryNotice } from '../../src/chat/provider-error.js'
import { initialTurnState, turnReducer } from '../../src/chat/turn-reducer.js'

describe('provider error messages', () => {
  test('describeProviderError gives a hint by kind', () => {
    const error = new ProviderError({
      message: 'anthropic request failed with status 401: invalid x-api-key',
      kind: 'auth',
      provider: 'anthropic',
      status: 401,
    })
    expect(describeProviderError(error)).toBe(
      'authentication failed (401): anthropic request failed with status 401: invalid x-api-key — check the API key or credentials for this provider',
    )
  })

  test('retryNotice', () => {
    const error = new ProviderError({
      message: 'x',
      kind: 'rate_limit',
      provider: 'openai',
      status: 429,
    })
    expect(
      retryNotice({
        type: 'retry',
        iteration: 1,
        attempt: 1,
        maxRetries: 2,
        error,
        retryInMs: 4000,
        timestamp: 0,
      }),
    ).toBe('rate limited (429) — retrying in 4s (1/2)')
    expect(
      retryNotice({
        type: 'retry',
        iteration: 1,
        attempt: 2,
        maxRetries: 2,
        error: new Error('flaky'),
        retryInMs: 250,
        timestamp: 0,
      }),
    ).toBe('flaky — retrying in 250ms (2/2)')
  })

  test('a retry restarts the waiting display', () => {
    const started = turnReducer(initialTurnState(), { type: 'start', prompt: 'hi', timestamp: 1 })
    const retried = turnReducer(started, {
      type: 'retry',
      iteration: 1,
      attempt: 1,
      maxRetries: 2,
      error: null,
      retryInMs: 0,
      timestamp: 50,
    })
    expect(retried.state).toBe('streaming')
    expect(retried.streamStartedAt).toBe(50)
  })
})
