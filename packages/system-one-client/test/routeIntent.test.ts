import { describe, expect, test, vi } from 'vitest'

import { SystemOneClient } from '../src/client.js'
import { routeIntent } from '../src/routeIntent.js'
import type { ChoiceQuestion } from '../src/types.js'

const question: ChoiceQuestion = {
  type: 'choice',
  instructions: 'Which tool?',
  criteria: { search: 'lookups', write: 'edits' },
}

describe('routeIntent', () => {
  test('returns the top label, confidence, and model', async () => {
    const client = new SystemOneClient({
      backend: {
        predict: vi.fn(async () => ({
          model: 'english',
          answers: {
            intent: {
              type: 'choice',
              choice: 'search',
              confidence: 0.88,
              probabilities: { search: 0.88 },
            },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
      defaultModel: 'english',
    })
    const route = await routeIntent({ client, state: 'find the docs', question })
    expect(route).toEqual({ label: 'search', confidence: 0.88, model: 'english' })
  })
})
