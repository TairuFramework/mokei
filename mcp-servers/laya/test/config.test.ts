import { guardQuestions, type LayaClient } from '@mokei/laya-client'
import { describe, expect, test, vi } from 'vitest'

import { createLayaTools } from '../src/config.js'

function fakeClient(answers: Record<string, unknown>): LayaClient {
  return {
    predict: vi.fn(async () => ({
      model: 'english',
      answers,
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  } as unknown as LayaClient
}

describe('createLayaTools', () => {
  test('predict tool calls the client and returns JSON text', async () => {
    const client = fakeClient({
      dept: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } },
    })
    const tools = createLayaTools({ client })
    const res = (await tools.predict.handler({
      input: { state: 'hi', questions: { dept: { type: 'choice', criteria: { billing: 'x' } } } },
      signal: new AbortController().signal,
    } as never)) as { isError: boolean; content: Array<{ text?: string }> }
    expect(res.isError).toBe(false)
    expect(res.content.length).toBeGreaterThan(0)
    expect(res.content[0]?.text).toContain('billing')
  })

  test('preset tools classify with a fixed question set', async () => {
    const client = fakeClient({ jailbreak: { type: 'noul', noul: 0.1 } })
    const tools = createLayaTools({ client })
    const res = (await tools.guard.handler({
      input: { state: 'hello' },
      signal: new AbortController().signal,
    } as never)) as { isError: boolean; content: Array<{ text?: string }> }
    expect(res.isError).toBe(false)
    expect(res.content[0]?.text).toContain('jailbreak')
    expect(vi.mocked(client.predict)).toHaveBeenCalledWith(
      expect.objectContaining({ questions: guardQuestions() }),
    )
  })
})
