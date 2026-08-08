import { describe, expect, test } from 'vitest'

import {
  inputRequired,
  isInputRequiredResult,
  liftRetryParams,
  MRTR_METHODS,
  missingInputCapabilities,
  resolveRequestState,
} from '../src/mrtr.js'

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

describe('inputRequired', () => {
  test('builds a suspended result', () => {
    const request = { method: 'roots/list' as const, params: {} }
    expect(inputRequired({ inputRequests: { ask: request }, requestState: 'opaque' })).toEqual({
      resultType: 'input_required',
      inputRequests: { ask: request },
      requestState: 'opaque',
    })
  })

  test('refuses a suspension that carries neither field', () => {
    expect(() => inputRequired({})).toThrow(/at least one/i)
    expect(() => inputRequired({ inputRequests: {} })).toThrow(/at least one/i)
  })

  test('recognises its own output', () => {
    expect(isInputRequiredResult(inputRequired({ requestState: 'opaque' }))).toBe(true)
    expect(isInputRequiredResult({ content: [] })).toBe(false)
  })
})

describe('MRTR_METHODS', () => {
  test('is exactly the three methods that may suspend', () => {
    expect([...MRTR_METHODS].sort()).toEqual(['prompts/get', 'resources/read', 'tools/call'])
  })
})

describe('missingInputCapabilities', () => {
  const sampling = {
    method: 'sampling/createMessage' as const,
    params: { maxTokens: 1, messages: [] },
  }

  test('reports the capability a client did not declare', () => {
    expect(missingInputCapabilities({ ask: sampling }, {})).toEqual({ sampling: {} })
  })

  test('reports nothing when the client declared it', () => {
    expect(missingInputCapabilities({ ask: sampling }, { sampling: {} })).toBeUndefined()
  })

  test('reports nothing for an empty request map', () => {
    expect(missingInputCapabilities(undefined, {})).toBeUndefined()
  })
})
