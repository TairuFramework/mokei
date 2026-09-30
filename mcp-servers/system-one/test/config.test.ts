import type { SystemOneClient } from '@mokei/system-one-client'
import { createValidator } from '@sozai/schema'
import { describe, expect, test, vi } from 'vitest'

import { createSystemOneTools, predictOutputSchema } from '../src/config.js'

function fakeClient(answers: Record<string, unknown>): SystemOneClient {
  return {
    predict: vi.fn(async () => ({
      model: 'english',
      answers,
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  } as unknown as SystemOneClient
}

function abortingClient(): SystemOneClient {
  return {
    predict: vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    }),
  } as unknown as SystemOneClient
}

describe('createSystemOneTools', () => {
  test('predict tool calls the client and returns JSON text', async () => {
    const client = fakeClient({
      dept: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } },
    })
    const tools = createSystemOneTools({ client })
    const res = (await tools.predict.handler({
      input: {
        state: 'hi',
        questions: {
          dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'x' } },
        },
      },
      signal: new AbortController().signal,
    } as never)) as { isError: boolean; content: Array<{ text?: string }> }
    expect(res.isError).toBe(false)
    expect(res.content.length).toBeGreaterThan(0)
    expect(res.content[0]?.text).toContain('billing')
  })

  test('predict returns structuredContent matching outputSchema', async () => {
    const result = {
      model: 'english',
      answers: {
        dept: {
          type: 'choice',
          choice: 'billing',
          confidence: 1,
          probabilities: { billing: 1 },
        },
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    }
    const validate = createValidator(predictOutputSchema)
    const tools = createSystemOneTools({ client: fakeClient(result.answers) })
    const response = (await tools.predict.handler({
      input: {
        state: 'hi',
        questions: {
          dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'x' } },
        },
      },
      signal: new AbortController().signal,
    } as never)) as {
      structuredContent?: unknown
      content: Array<{ text?: string }>
    }

    expect(validate(response.structuredContent)).not.toHaveProperty('issues')
    expect(validate({ ...result, error: { type: 'failure' } })).toHaveProperty('issues')
    expect(response.structuredContent).toEqual(result)
    expect(response.content[0]?.text).toBe(JSON.stringify(result))
  })

  test('predict tool rethrows when the request was cancelled instead of returning isError', async () => {
    const client = abortingClient()
    const tools = createSystemOneTools({ client })
    const controller = new AbortController()
    controller.abort()
    await expect(
      tools.predict.handler({
        input: {
          state: 'hi',
          questions: {
            dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'x' } },
          },
        },
        signal: controller.signal,
      } as never),
    ).rejects.toThrow(DOMException)
  })
})
