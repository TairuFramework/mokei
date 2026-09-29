import {
  createSystemOneClient,
  HTTPSystemOneBackend,
  type PredictResult,
  type QuestionMap,
  SystemOneAuthError,
  SystemOneInputError,
} from '@mokei/system-one-client'
import { describe, expect, inject, test } from 'vitest'

const laya = inject('laya')

function requireLaya(): { url: string; apiKey: string } {
  if (laya == null) throw new Error('laya-serve is not configured (MOKEI_LAYA_SERVE_BIN)')
  return laya
}

const questions = {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this message?',
    criteria: {
      billing: 'invoices, charges and refunds',
      technical: 'bugs, outages and errors',
    },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this message?',
    criteria: ['not urgent', 'somewhat urgent', 'very urgent'],
  },
  complaint: { type: 'noul', instructions: 'Is the customer complaining?' },
} satisfies QuestionMap

const BILLING = 'I was charged twice for my subscription this month.'
const CRASH = 'The app crashes every time I open the settings page.'

// Structural only: which answer a model picks is model-dependent.
function expectWellFormed(result: PredictResult<typeof questions>): void {
  const { department, urgency, complaint } = result.answers
  expect(Object.keys(questions.department.criteria)).toContain(department.choice)
  const total = Object.values(department.probabilities).reduce((sum, p) => sum + p, 0)
  expect(total).toBeCloseTo(1, 2)
  expect(Number.isFinite(urgency.score)).toBe(true)
  expect(complaint.noul).toBeGreaterThanOrEqual(0)
  expect(complaint.noul).toBeLessThanOrEqual(1)
  expect(result.usage.inputTokens).toBeGreaterThan(0)
}

test('laya setup supplies a gate', () => {
  expect(laya).not.toBeUndefined()
})

describe.skipIf(laya == null)('HTTPSystemOneBackend against laya-serve', () => {
  test('predict answers choice, score and noul questions', async () => {
    const client = createSystemOneClient({
      url: requireLaya().url,
      apiKey: requireLaya().apiKey,
      defaultModel: 'english',
    })
    const result = await client.predict({ state: BILLING, questions })
    expectWellFormed(result)
    expect(result.extras?.routing).toMatchObject({ model: 'english' })
  })

  // Unlike the structural checks, this pins the english checkpoint's answers on two unambiguous
  // messages, so a checkpoint regression shows up here.
  test('predict routes billing and technical messages', async () => {
    const client = createSystemOneClient({
      url: requireLaya().url,
      apiKey: requireLaya().apiKey,
      defaultModel: 'english',
    })
    const billing = await client.predict({ state: BILLING, questions })
    const crash = await client.predict({ state: CRASH, questions })
    expectWellFormed(crash)
    expect(billing.answers.department.choice).toBe('billing')
    expect(crash.answers.department.choice).toBe('technical')
  })

  test('predict accepts structured instructions and criteria', async () => {
    const client = createSystemOneClient({
      url: requireLaya().url,
      apiKey: requireLaya().apiKey,
      defaultModel: 'english',
    })
    const result = await client.predict({
      state: { channel: 'email', body: BILLING },
      questions: {
        department: {
          type: 'choice',
          instructions: {
            question: 'Which department should handle this?',
            policy: 'refunds go to billing',
          },
          criteria: {
            billing: { handles: ['invoices', 'refunds'] },
            technical: ['bugs', 'outages'],
            other: null,
          },
        },
        urgency: {
          type: 'score',
          instructions: ['How urgent is this message?', 'Duplicate charges are urgent.'],
          criteria: ['not urgent', { level: 'urgent', within: 'a day' }],
        },
        refund: {
          type: 'noul',
          instructions: 'Does the customer want a refund?',
          criteria: { true: 'asks for money back', false: 'anything else' },
        },
      },
    })
    expect(Object.keys(result.answers)).toEqual(['department', 'urgency', 'refund'])
    expect(['billing', 'technical', 'other']).toContain(result.answers.department.choice)
  })

  test('a wrong API key rejects with SystemOneAuthError', async () => {
    const client = createSystemOneClient({
      url: requireLaya().url,
      apiKey: 'wrong',
      defaultModel: 'english',
    })
    await expect(client.predict({ state: BILLING, questions })).rejects.toThrow(SystemOneAuthError)
  })

  test('a 422 rejects with SystemOneInputError carrying the server reason', async () => {
    // The backend skips client validation, so the server sees the missing instructions.
    const backend = new HTTPSystemOneBackend({
      url: requireLaya().url,
      apiKey: requireLaya().apiKey,
    })
    const request = backend.predict({
      state: BILLING,
      questions: { department: { type: 'noul' } } as unknown as QuestionMap,
      model: 'english',
    })
    await expect(request).rejects.toThrow(SystemOneInputError)
    await expect(request).rejects.toThrow(/rejected the request \(422\): .*instructions/)
  })
})
