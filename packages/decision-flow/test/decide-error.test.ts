import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
  SystemOneResponseError,
} from '@mokei/system-one-client'
import { MAX_DELAY_MS } from '@sozai/async'
import { describe, expect, test } from 'vitest'

import { describeDecisionError, retryableDecision } from '../src/decide-error.js'
import { InvalidDecisionStateError } from '../src/decide-node.js'

describe('retryableDecision', () => {
  test('delegates System One retry decisions', () => {
    expect(
      retryableDecision(new SystemOneConnectionError({ message: 'secret', status: 503 })),
    ).toBe(true)
    expect(
      retryableDecision(
        new SystemOneRateLimitError({ message: 'secret', status: 429, retryAfterMs: 250 }),
      ),
    ).toEqual({ afterMs: 250 })
    expect(retryableDecision(new SystemOneAuthError({ message: 'secret' }))).toBe(false)
  })
})

describe('describeDecisionError', () => {
  test('describes a connection error without copying its message or cause', () => {
    const error = new SystemOneConnectionError({
      message: 'secret message',
      status: 503,
      cause: new Error('secret cause'),
    })

    const metadata = describeDecisionError(error)

    expect(metadata).toEqual({ type: 'SystemOneConnectionError', status: 503 })
    expect(metadata).not.toHaveProperty('message')
    expect(metadata).not.toHaveProperty('cause')
  })

  test.each([
    [
      'SystemOneInputError',
      new SystemOneInputError({
        message: 'secret input message',
        cause: new Error('secret cause'),
      }),
      { type: 'SystemOneInputError' },
    ],
    [
      'SystemOneAuthError',
      new SystemOneAuthError({ message: 'secret auth message', cause: new Error('secret cause') }),
      { type: 'SystemOneAuthError' },
    ],
    [
      'SystemOneModelError',
      new SystemOneModelError({
        message: 'secret model message',
        cause: new Error('secret cause'),
      }),
      { type: 'SystemOneModelError' },
    ],
    [
      'SystemOneResponseError',
      new SystemOneResponseError({
        message: 'secret response message',
        cause: new Error('secret cause'),
      }),
      { type: 'SystemOneResponseError' },
    ],
    [
      'SystemOneError',
      new SystemOneError({ message: 'secret generic message', cause: new Error('secret cause') }),
      { type: 'SystemOneError' },
    ],
  ])('describes %s without its message or cause', (_name, error, expectedMetadata) => {
    const metadata = describeDecisionError(error)

    expect(metadata).toEqual(expectedMetadata)
    expect(metadata).not.toHaveProperty('message')
    expect(metadata).not.toHaveProperty('cause')
  })

  test('bounds finite retry-after metadata', () => {
    const error = new SystemOneRateLimitError({
      message: 'secret',
      status: 429,
      retryAfterMs: MAX_DELAY_MS + 100,
    })

    expect(describeDecisionError(error)).toEqual({
      type: 'SystemOneRateLimitError',
      status: 429,
      retryAfterMs: MAX_DELAY_MS,
    })
  })

  test('bounds negative retry-after metadata at zero', () => {
    const error = new SystemOneOverloadedError({
      message: 'secret',
      status: 529,
      retryAfterMs: -5,
    })

    expect(describeDecisionError(error)).toEqual({
      type: 'SystemOneOverloadedError',
      status: 529,
      retryAfterMs: 0,
    })
  })

  test('describes invalid decision state without its message', () => {
    const error = new InvalidDecisionStateError()
    const metadata = describeDecisionError(error)

    expect(metadata).toEqual({ type: 'invalid_state', code: 'invalid_state' })
    expect(metadata).not.toHaveProperty('message')
  })

  test('uses the error name for other errors without exposing message or cause', () => {
    const error = new Error('secret message', { cause: new Error('secret cause') })
    const metadata = describeDecisionError(error)

    expect(metadata).toEqual({ type: 'Error' })
    expect(metadata).not.toHaveProperty('message')
    expect(metadata).not.toHaveProperty('cause')
  })
})
