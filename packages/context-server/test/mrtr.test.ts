import { describe, expect, test } from 'vitest'

import { liftRetryParams, resolveRequestState } from '../src/mrtr.js'

describe('liftRetryParams', () => {
  test('removes both fields and reports them', () => {
    const { params, lifted } = liftRetryParams({
      name: 'ask',
      inputResponses: { a: { roots: [] } },
      requestState: 'opaque',
    })
    expect(params).toEqual({ name: 'ask' })
    expect(lifted).toEqual({ inputResponses: { a: { roots: [] } }, requestState: 'opaque' })
  })

  test('returns the same reference when neither field is present', () => {
    const original = { name: 'ask' }
    const { params, lifted } = liftRetryParams(original)
    expect(params).toBe(original)
    expect(lifted).toEqual({})
  })

  test('ignores a non-object params', () => {
    expect(liftRetryParams(undefined).lifted).toEqual({})
  })
})

describe('resolveRequestState', () => {
  test('returns the raw string with no verify hook', () => {
    expect(resolveRequestState('opaque', undefined)).toBe('opaque')
    expect(resolveRequestState('opaque', {})).toBe('opaque')
  })

  test('returns the hook payload when verification succeeds', () => {
    expect(resolveRequestState('{"step":1}', { verify: (raw) => JSON.parse(raw) })).toEqual({
      step: 1,
    })
  })

  test('propagates a verify hook refusal', () => {
    expect(() =>
      resolveRequestState('bad', {
        verify: () => {
          throw new Error('signature mismatch')
        },
      }),
    ).toThrow('signature mismatch')
  })

  test('returns undefined when no state was sent', () => {
    expect(resolveRequestState(undefined, { verify: () => 'never' })).toBeUndefined()
  })
})
