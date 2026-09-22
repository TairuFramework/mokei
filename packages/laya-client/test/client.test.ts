import { describe, expect, test, vi } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'
import { LayaClient } from '../src/client.js'
import { LayaError, LayaInputError } from '../src/errors.js'

const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

function result(answers: Record<string, unknown>): LayaResult {
  return {
    model: 'english',
    answers,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

describe('LayaClient.predict', () => {
  test('validates, dispatches, returns a typed result', async () => {
    const backend: LayaBackend = {
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
    const client = new LayaClient({ backend, defaultModel: 'english' })
    const res = await client.predict({ state: 'hi', questions })
    expect(res.answers.dept.choice).toBe('billing')
  })

  test('throws LayaInputError on a malformed question map before any backend call', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    await expect(
      client.predict({ state: 'hi', questions: { dept: { type: 'choice' } } as never }),
    ).rejects.toThrow(LayaInputError)
    expect(predict).not.toHaveBeenCalled()
  })

  test('throws LayaError when no model resolves', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict } })
    await expect(client.predict({ state: 'hi', questions })).rejects.toThrow(LayaError)
    expect(predict).not.toHaveBeenCalled()
  })

  test('per-call model overrides defaultModel', async () => {
    const predict = vi.fn(async () =>
      result({
        dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
      }),
    )
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    await client.predict({ state: 'hi', questions, model: 'multilingual' })
    const firstCall = (predict.mock.calls.at(0) as unknown as Array<unknown>)?.[0] as unknown as {
      model?: string
    }
    expect(firstCall?.model).toBe('multilingual')
  })
})

describe('LayaClient.predictBatch', () => {
  const answer = {
    dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
  }

  test('returns [] and issues no request for empty states', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: [], questions })).toEqual([])
    expect(predict).not.toHaveBeenCalled()
  })

  test('uses backend.batch when present', async () => {
    const batch = vi.fn(async () => [result(answer), result(answer)])
    const client = new LayaClient({ backend: { predict: vi.fn(), batch }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(batch).toHaveBeenCalledOnce()
  })

  test('falls back to sequential predict when batch is absent', async () => {
    const predict = vi.fn(async () => result(answer))
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(predict).toHaveBeenCalledTimes(2)
  })
})
