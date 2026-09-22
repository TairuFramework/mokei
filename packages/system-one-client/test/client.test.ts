import { describe, expect, test, vi } from 'vitest'

import type { SystemOneBackend, SystemOneResult } from '../src/backend.js'
import { SystemOneClient } from '../src/client.js'
import { SystemOneError, SystemOneInputError } from '../src/errors.js'

const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

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

  test('uses backend.batch when present', async () => {
    const batch = vi.fn(async () => [result(answer), result(answer)])
    const client = new SystemOneClient({
      backend: { predict: vi.fn(), batch },
      defaultModel: 'english',
    })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(batch).toHaveBeenCalledOnce()
  })

  test('falls back to sequential predict when batch is absent', async () => {
    const predict = vi.fn(async () => result(answer))
    const client = new SystemOneClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(predict).toHaveBeenCalledTimes(2)
  })
})
