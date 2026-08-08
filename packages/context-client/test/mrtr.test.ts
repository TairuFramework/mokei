import { describe, expect, test, vi } from 'vitest'

import {
  InputRequiredRoundsExceededError,
  isInputRequiredResult,
  REQUEST_STATE_ONLY_PACING_MS,
  runInputRequiredFlow,
} from '../src/mrtr.js'

const ASK = {
  method: 'roots/list' as const,
  params: {},
}

describe('isInputRequiredResult', () => {
  test('recognises the discriminator and nothing else', () => {
    expect(isInputRequiredResult({ resultType: 'input_required' })).toBe(true)
    expect(isInputRequiredResult({ resultType: 'complete' })).toBe(false)
    expect(isInputRequiredResult(null)).toBe(false)
    expect(isInputRequiredResult('input_required')).toBe(false)
  })
})

describe('runInputRequiredFlow', () => {
  test('fulfils one round and returns the complete result', async () => {
    const dispatch = vi.fn(async () => ({ roots: [] }))
    const retry = vi.fn(async () => ({ content: [], resultType: 'complete' }))
    const result = await runInputRequiredFlow({
      method: 'tools/call',
      first: { inputRequests: { ask: ASK }, requestState: 'state-1' },
      maxRounds: 10,
      dispatch,
      retry,
    })
    expect(result).toEqual({ content: [], resultType: 'complete' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledWith(
      { inputResponses: { ask: { roots: [] } }, requestState: 'state-1' },
      undefined,
    )
  })

  test('carries the next round payload when the retry suspends again', async () => {
    const dispatch = vi.fn(async () => ({ roots: [] }))
    const retry = vi
      .fn()
      .mockResolvedValueOnce({
        resultType: 'input_required',
        inputRequests: { again: ASK },
        requestState: 'state-2',
      })
      .mockResolvedValueOnce({ content: [], resultType: 'complete' })
    await runInputRequiredFlow({
      method: 'tools/call',
      first: { inputRequests: { ask: ASK } },
      maxRounds: 10,
      dispatch,
      retry,
    })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(retry).toHaveBeenNthCalledWith(
      2,
      { inputResponses: { again: { roots: [] } }, requestState: 'state-2' },
      undefined,
    )
  })

  test('paces a requestState-only leg and counts it against the cap', async () => {
    const sleep = vi.fn(async () => {})
    const retry = vi.fn(async () => ({ content: [], resultType: 'complete' }))
    await runInputRequiredFlow({
      method: 'tools/call',
      first: { requestState: 'state-1' },
      maxRounds: 10,
      dispatch: async () => ({ roots: [] }),
      retry,
      sleep,
    })
    expect(sleep).toHaveBeenCalledWith(REQUEST_STATE_ONLY_PACING_MS, undefined)
    expect(retry).toHaveBeenCalledWith({ requestState: 'state-1' }, undefined)
  })

  test('raises InputRequiredRoundsExceededError at the cap', async () => {
    const suspended = { resultType: 'input_required', inputRequests: { ask: ASK } }
    await expect(
      runInputRequiredFlow({
        method: 'tools/call',
        first: { inputRequests: { ask: ASK } },
        maxRounds: 2,
        dispatch: async () => ({ roots: [] }),
        retry: async () => suspended,
      }),
    ).rejects.toThrow(InputRequiredRoundsExceededError)
  })

  test('aborts sibling dispatches when one fails', async () => {
    const aborted: Array<boolean> = []
    const dispatch = vi.fn(async (key: string, _request: unknown, signal: AbortSignal) => {
      if (key === 'bad') {
        throw new Error('handler failed')
      }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      aborted.push(signal.aborted)
      return { roots: [] }
    })
    await expect(
      runInputRequiredFlow({
        method: 'tools/call',
        first: { inputRequests: { bad: ASK, slow: ASK } },
        maxRounds: 10,
        dispatch,
        retry: async () => ({ content: [], resultType: 'complete' }),
      }),
    ).rejects.toThrow('handler failed')
    expect(aborted).toEqual([true])
  })

  test('shrinks the per-leg budget under maxTotalTimeout', async () => {
    const legTimeouts: Array<number | undefined> = []
    let now = 1000
    await runInputRequiredFlow({
      method: 'tools/call',
      first: { inputRequests: { ask: ASK } },
      maxRounds: 10,
      timeout: 5_000,
      maxTotalTimeout: 8_000,
      startedAt: 1000,
      now: () => {
        now += 3_000
        return now
      },
      dispatch: async () => ({ roots: [] }),
      retry: async (_params, timeout) => {
        legTimeouts.push(timeout)
        return { content: [], resultType: 'complete' }
      },
    })
    expect(legTimeouts).toEqual([5_000])
  })

  test('fails the flow when the total budget is already spent', async () => {
    await expect(
      runInputRequiredFlow({
        method: 'tools/call',
        first: { inputRequests: { ask: ASK } },
        maxRounds: 10,
        maxTotalTimeout: 1_000,
        startedAt: 0,
        now: () => 5_000,
        dispatch: async () => ({ roots: [] }),
        retry: async () => ({ content: [], resultType: 'complete' }),
      }),
    ).rejects.toThrow(/total timeout/i)
  })
})
