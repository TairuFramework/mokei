import { describe, expect, test, vi } from 'vitest'

import type { SystemOneBackend, SystemOneResult } from '../src/backend.js'
import { SystemOneClient } from '../src/client.js'
import { SystemOneError, SystemOneInputError } from '../src/errors.js'

const questions = {
  dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'x' } },
} as const

function result(answers: Record<string, unknown>): SystemOneResult {
  return {
    model: 'english',
    answers,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

describe('SystemOneClient.predict', () => {
  test('validates, dispatches, returns a typed result', async () => {
    const backend: SystemOneBackend = {
      predict: vi.fn(async () =>
        result({
          dept: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.9,
            probabilities: { billing: 0.9 },
          },
        }),
      ),
    }
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const res = await client.predict({ state: 'hi', questions })
    expect(res.answers.dept.choice).toBe('billing')
  })

  test('throws SystemOneInputError on a malformed question map before any backend call', async () => {
    const predict = vi.fn()
    const client = new SystemOneClient({ backend: { predict }, defaultModel: 'english' })
    await expect(
      client.predict({ state: 'hi', questions: { dept: { type: 'choice' } } as never }),
    ).rejects.toThrow(SystemOneInputError)
    expect(predict).not.toHaveBeenCalled()
  })

  test('throws SystemOneError when no model resolves', async () => {
    const predict = vi.fn()
    const client = new SystemOneClient({ backend: { predict } })
    await expect(client.predict({ state: 'hi', questions })).rejects.toThrow(SystemOneError)
    expect(predict).not.toHaveBeenCalled()
  })

  test('per-call model overrides defaultModel', async () => {
    const predict = vi.fn(async () =>
      result({
        dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
      }),
    )
    const client = new SystemOneClient({ backend: { predict }, defaultModel: 'english' })
    await client.predict({ state: 'hi', questions, model: 'multilingual' })
    const firstCall = (predict.mock.calls.at(0) as unknown as Array<unknown>)?.[0] as unknown as {
      model?: string
    }
    expect(firstCall?.model).toBe('multilingual')
  })
})

describe('SystemOneClient.predictBatch', () => {
  const answer = {
    dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
  }

  test('returns [] and issues no request for empty states', async () => {
    const predict = vi.fn()
    const client = new SystemOneClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: [], questions })).toEqual([])
    expect(predict).not.toHaveBeenCalled()
  })

  test('sends one predict call per state', async () => {
    const predict = vi.fn(async () => result(answer))
    const client = new SystemOneClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(predict).toHaveBeenCalledTimes(2)
  })
})

describe('SystemOneClient.predictBatch fallback concurrency', () => {
  const answer = {
    dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
  }

  type Pending = {
    state: string
    signal: AbortSignal
    resolve: (raw: SystemOneResult) => void
    reject: (error: unknown) => void
  }

  function deferredBackend() {
    const pending: Array<Pending> = []
    let inFlight = 0
    let maxInFlight = 0
    const backend: SystemOneBackend = {
      predict: (params) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        return new Promise<SystemOneResult>((resolve, reject) => {
          pending.push({
            state: params.state as string,
            signal: params.signal as AbortSignal,
            resolve,
            reject,
          })
        }).finally(() => {
          inFlight--
        })
      },
    }
    return { backend, pending, maxInFlight: () => maxInFlight }
  }

  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  function call(pending: Array<Pending>, index: number): Pending {
    const entry = pending[index]
    if (entry == null) throw new Error(`No predict call at index ${index}`)
    return entry
  }

  function succeed(entry: Pending): void {
    entry.resolve({ ...result(answer), model: entry.state })
  }

  test('keeps results in input order when calls finish out of order', async () => {
    const { backend, pending } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const batch = client.predictBatch({ states: ['a', 'b', 'c'], questions })
    await flush()
    for (const entry of [...pending].reverse()) {
      succeed(entry)
    }
    const results = await batch
    expect(results.map((r) => r.model)).toEqual(['a', 'b', 'c'])
  })

  test('runs at most 4 calls at once by default', async () => {
    const { backend, pending, maxInFlight } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const states = ['a', 'b', 'c', 'd', 'e', 'f']
    const batch = client.predictBatch({ states, questions })
    await flush()
    expect(pending).toHaveLength(4)
    for (let i = 0; i < states.length; i++) {
      succeed(call(pending, i))
      await flush()
    }
    const results = await batch
    expect(results.map((r) => r.model)).toEqual(states)
    expect(maxInFlight()).toBe(4)
  })

  test('honors a custom concurrency', async () => {
    const { backend, pending, maxInFlight } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const batch = client.predictBatch({ states: ['a', 'b', 'c'], questions, concurrency: 2 })
    await flush()
    expect(pending).toHaveLength(2)
    succeed(call(pending, 0))
    await flush()
    expect(pending).toHaveLength(3)
    succeed(call(pending, 1))
    succeed(call(pending, 2))
    await batch
    expect(maxInFlight()).toBe(2)
  })

  test('aborts in-flight calls and starts no more after the first failure', async () => {
    const { backend, pending } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const batch = client.predictBatch({
      states: ['a', 'b', 'c', 'd', 'e', 'f'],
      questions,
      concurrency: 2,
    })
    await flush()
    const error = new Error('boom')
    call(pending, 0).reject(error)
    await expect(batch).rejects.toBe(error)
    expect(call(pending, 1).signal.aborted).toBe(true)
    expect(pending).toHaveLength(2)
  })

  test('aborts in-flight calls when a response fails validation', async () => {
    const { backend, pending } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const batch = client.predictBatch({ states: ['a', 'b'], questions })
    await flush()
    call(pending, 0).resolve({ ...result({}), model: 'a' })
    await expect(batch).rejects.toThrow(SystemOneError)
    expect(call(pending, 1).signal.aborted).toBe(true)
  })

  test('forwards a caller abort to in-flight calls', async () => {
    const { backend, pending } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    const controller = new AbortController()
    const batch = client.predictBatch({ states: ['a', 'b'], questions, signal: controller.signal })
    await flush()
    controller.abort()
    expect(pending.every((p) => p.signal.aborted)).toBe(true)
    for (const entry of pending) {
      entry.reject(entry.signal.reason)
    }
    await expect(batch).rejects.toThrow()
  })

  test('rejects a concurrency below 1 before any request', async () => {
    const { backend, pending } = deferredBackend()
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    await expect(client.predictBatch({ states: ['a'], questions, concurrency: 0 })).rejects.toThrow(
      SystemOneInputError,
    )
    expect(pending).toHaveLength(0)
  })
})
