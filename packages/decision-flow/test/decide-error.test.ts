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
  test.each([408, 429, 500, 502, 503, 504, 529])('retries connection status %i', (status) => {
    expect(retryableDecision(new SystemOneConnectionError({ message: 'secret', status }))).toBe(
      true,
    )
  })

  test('retries a connection error without a status', () => {
    expect(retryableDecision(new SystemOneConnectionError({ message: 'secret' }))).toBe(true)
  })

  test.each([400, 401, 403, 404, 422, 501])('does not retry connection status %i', (status) => {
    expect(retryableDecision(new SystemOneConnectionError({ message: 'secret', status }))).toBe(
      false,
    )
  })

  test('uses a finite retry-after delay', () => {
    const error = new SystemOneRateLimitError({ message: 'secret', status: 429, retryAfterMs: 250 })

    expect(retryableDecision(error)).toEqual({ afterMs: 250 })
  })

  test('ignores an infinite server wait', () => {
    const error = new SystemOneRateLimitError({
      message: 'secret',
      status: 429,
      retryAfterMs: Number.POSITIVE_INFINITY,
    })

    expect(retryableDecision(error)).toBe(true)
    expect(describeDecisionError(error)).toEqual({ type: 'SystemOneRateLimitError', status: 429 })
  })

  test.each([
    new SystemOneAuthError({ message: 'secret' }),
    new SystemOneInputError({ message: 'secret' }),
    new SystemOneModelError({ message: 'secret' }),
    new SystemOneResponseError({ message: 'secret' }),
    new SystemOneError({ message: 'secret' }),
    new InvalidDecisionStateError(),
    new Error('secret'),
  ])('does not retry non-connection errors (%s)', (error) => {
    expect(retryableDecision(error)).toBe(false)
  })

  test('retries overloaded errors with their published 529 status', () => {
    expect(
      retryableDecision(
        new SystemOneOverloadedError({ message: 'secret', status: 529, retryAfterMs: 800 }),
      ),
    ).toEqual({ afterMs: 800 })
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
