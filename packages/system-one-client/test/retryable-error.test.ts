import { describe, expect, test } from 'vitest'

import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
  SystemOneResponseError,
} from '../src/errors.js'
import { retryableSystemOneError } from '../src/retryable-error.js'

describe('retryableSystemOneError', () => {
  test.each([408, 429, 500, 502, 503, 504, 529])('retries status %i', (status) => {
    expect(
      retryableSystemOneError(new SystemOneConnectionError({ message: 'secret', status })),
    ).toBe(true)
  })
  test('retries a network failure', () => {
    expect(retryableSystemOneError(new SystemOneConnectionError({ message: 'secret' }))).toBe(true)
  })
  test.each([400, 401, 403, 404, 422, 501])('rejects status %i', (status) => {
    expect(
      retryableSystemOneError(new SystemOneConnectionError({ message: 'secret', status })),
    ).toBe(false)
  })
  test.each([SystemOneRateLimitError, SystemOneOverloadedError])(
    'uses finite retry-after for %s',
    (ErrorClass) => {
      expect(
        retryableSystemOneError(new ErrorClass({ message: 'secret', retryAfterMs: 250 })),
      ).toEqual({ afterMs: 250 })
      expect(
        retryableSystemOneError(
          new ErrorClass({ message: 'secret', retryAfterMs: Number.POSITIVE_INFINITY }),
        ),
      ).toBe(true)
    },
  )
  test.each([
    new SystemOneAuthError({ message: 'secret' }),
    new SystemOneInputError({ message: 'secret' }),
    new SystemOneModelError({ message: 'secret' }),
    new SystemOneResponseError({ message: 'secret' }),
    new SystemOneError({ message: 'secret' }),
    new DOMException('aborted', 'AbortError'),
  ])('rejects non-connection errors (%s)', (error) => {
    expect(retryableSystemOneError(error)).toBe(false)
  })
})
