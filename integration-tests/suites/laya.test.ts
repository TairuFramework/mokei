import {
  createSystemOneClient,
  HTTPSystemOneBackend,
  type PredictResult,
  type QuestionMap,
  SystemOneAuthError,
  SystemOneInputError,
} from '@mokei/system-one-client'
import getPort from 'get-port'
import spawn, { type Subprocess } from 'nano-spawn'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

// Gated: runs only when MOKEI_LAYA_SERVE_BIN points at a `laya-serve` executable
// (`pip install "laya[serve]"`). The first start downloads the english checkpoint.
const BIN = process.env.MOKEI_LAYA_SERVE_BIN
const ENABLED = BIN != null && BIN !== ''
const API_KEY = 'mokei-integration'

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
const THANKS = 'Thanks, everything works great now.'

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

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`laya-serve did not answer ${url}/health within ${timeoutMs}ms`)
}

describe.skipIf(!ENABLED)('HTTPSystemOneBackend against laya-serve', () => {
  let server: Subprocess | undefined
  let url = ''

  beforeAll(async () => {
    const port = await getPort()
    url = `http://127.0.0.1:${port}`
    server = spawn(BIN as string, [], {
      env: {
        LAYA_HOST: '127.0.0.1',
        LAYA_PORT: String(port),
        LAYA_MODELS: 'english',
        LAYA_API_KEY: API_KEY,
        LAYA_LOG_LEVEL: 'warning',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    server.catch(() => {})
    await waitForHealth(url, 300_000)
    // The first inference pays one-off costs (device kernels, tokenizer), so warm up here and
    // keep per-test durations close to steady-state latency.
    const client = createSystemOneClient({ url, apiKey: API_KEY, defaultModel: 'english' })
    await client.predict({ state: THANKS, questions })
  }, 330_000)

  afterAll(async () => {
    const child = await server?.nodeChildProcess.catch(() => undefined)
    child?.kill('SIGTERM')
    await server?.catch(() => {})
  })

  test('predict answers choice, score and noul questions', async () => {
    const client = createSystemOneClient({ url, apiKey: API_KEY, defaultModel: 'english' })
    const result = await client.predict({ state: BILLING, questions })
    expectWellFormed(result)
    expect(result.extras?.routing).toMatchObject({ model: 'english' })
  })

  test('predict routes billing and technical messages', async () => {
    const client = createSystemOneClient({ url, apiKey: API_KEY, defaultModel: 'english' })
    const billing = await client.predict({ state: BILLING, questions })
    const crash = await client.predict({ state: CRASH, questions })
    expectWellFormed(crash)
    expect(billing.answers.department.choice).toBe('billing')
    expect(crash.answers.department.choice).toBe('technical')
  })

  test('predict accepts structured instructions and criteria', async () => {
    const client = createSystemOneClient({ url, apiKey: API_KEY, defaultModel: 'english' })
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
    const client = createSystemOneClient({ url, apiKey: 'wrong', defaultModel: 'english' })
    await expect(client.predict({ state: BILLING, questions })).rejects.toThrow(SystemOneAuthError)
  })

  test('a 422 rejects with SystemOneInputError carrying the server reason', async () => {
    // The backend skips client validation, so the server sees the missing instructions.
    const backend = new HTTPSystemOneBackend({ url, apiKey: API_KEY })
    const request = backend.predict({
      state: BILLING,
      questions: { department: { type: 'noul' } } as unknown as QuestionMap,
      model: 'english',
    })
    await expect(request).rejects.toThrow(SystemOneInputError)
    await expect(request).rejects.toThrow(/rejected the request \(422\): .*instructions/)
  })
})
