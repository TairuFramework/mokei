import { describe, expect, test, vi } from 'vitest'

import type { SystemOneBackend, SystemOneResult } from '../src/backend.js'
import { SystemOneClient } from '../src/client.js'
import { SystemOneInputError, SystemOneResponseError } from '../src/errors.js'
import { createSystemOneClient } from '../src/index.js'

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
  test('createSystemOneClient forwards retry to the HTTP backend', async () => {
    const rawResult = {
      model: 'english',
      answers: {
        dept: {
          type: 'choice',
          choice: 'billing',
          confidence: 0.9,
          probabilities: { billing: 0.9 },
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('busy', { status: 503, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rawResult), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const client = createSystemOneClient({
      url: 'http://localhost:8000',
      fetch: fetcher,
      defaultModel: 'english',
      retry: { maxAttempts: 2 },
    })
    expect((await client.predict({ state: 'hi', questions })).answers.dept.choice).toBe('billing')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

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

  test('predict without a model or default sends no model field', async () => {
    const predict = vi.fn<SystemOneBackend['predict']>(async () =>
      result({
        dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
      }),
    )
    const client = new SystemOneClient({ backend: { predict } })
    expect((await client.predict({ state: 'hi', questions })).answers.dept.choice).toBe('billing')
    expect(predict.mock.calls[0]?.[0].model).toBeUndefined()
  })

  test('rejects an undeclared choice returned by the backend', async () => {
    const backend: SystemOneBackend = {
      predict: async () =>
        result({
          dept: { type: 'choice', choice: 'other', confidence: 1, probabilities: { billing: 1 } },
        }),
    }
    const client = new SystemOneClient({ backend, defaultModel: 'english' })
    await expect(client.predict({ state: 'help', questions })).rejects.toThrow(
      SystemOneResponseError,
    )
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
