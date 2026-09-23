import { createServer } from 'node:net'
import { basename } from 'node:path'
import { LayaDaemonBackend } from '@mokei/laya-backend'
import {
  createSystemOneClient,
  HTTPSystemOneBackend,
  type PredictResult,
  type QuestionMap,
} from '@mokei/system-one-client'
import spawn, { type Subprocess } from 'nano-spawn'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const GGUF = process.env.MOKEI_LAYA_GGUF
const BIN = process.env.MOKEI_LAYA_BIN ?? 'laya'
const HAS_BIN = await spawn(BIN, ['help']).then(
  () => true,
  () => false,
)
// Gated: runs only when MOKEI_LAYA_GGUF points at a Laya GGUF and the laya binary resolves.
const ENABLED = GGUF != null && GGUF !== '' && HAS_BIN

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

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address != null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
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
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`laya serve did not answer ${url}/health within ${timeoutMs}ms`)
}

describe.skipIf(!ENABLED)('LayaDaemonBackend (real GGUF)', () => {
  let backend: LayaDaemonBackend

  beforeAll(() => {
    backend = new LayaDaemonBackend({ model: GGUF as string, binary: BIN })
  })

  afterAll(async () => {
    await backend?.close()
  })

  test('predict answers choice, score and noul questions', async () => {
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    const result = await client.predict({ state: BILLING, questions })
    expectWellFormed(result)
    expect(typeof result.extras?.family).toBe('string')
  })

  test('predictBatch answers every state in order', async () => {
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    const results = await client.predictBatch({ states: [BILLING, CRASH, THANKS], questions })
    expect(results).toHaveLength(3)
    for (const result of results) {
      expectWellFormed(result)
    }
  })

  test('listModels names the loaded GGUF', async () => {
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    expect(await client.listModels()).toEqual([{ name: basename(GGUF as string) }])
  })

  test('close() then predict starts a fresh daemon', async () => {
    await backend.close()
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    expectWellFormed(await client.predict({ state: THANKS, questions }))
  })
})

describe.skipIf(!ENABLED)('HTTPSystemOneBackend against laya serve', () => {
  let server: Subprocess | undefined
  let url = ''
  let model = ''

  beforeAll(async () => {
    const port = await freePort()
    url = `http://127.0.0.1:${port}`
    server = spawn(BIN, ['serve', GGUF as string, '--port', String(port)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    server.catch(() => {})
    await waitForHealth(url, 60_000)
    const [first] = await createSystemOneClient({ url }).listModels()
    model = first?.name ?? 'laya'
  }, 90_000)

  afterAll(async () => {
    const child = await server?.nodeChildProcess.catch(() => undefined)
    child?.kill('SIGTERM')
    await server?.catch(() => {})
  })

  test('listModels returns the served families', async () => {
    const models = await createSystemOneClient({ url }).listModels()
    expect(models.length).toBeGreaterThan(0)
    for (const entry of models) {
      expect(typeof entry.name).toBe('string')
    }
  })

  test('predict calls /v1/systemone', async () => {
    const client = createSystemOneClient({ url, defaultModel: model })
    expectWellFormed(await client.predict({ state: BILLING, questions }))
  })

  test('batch: true serves predictBatch from /v1/decide/batch', async () => {
    const backend = new HTTPSystemOneBackend({ url, batch: true })
    const raws = await backend.batch?.({ states: [BILLING, CRASH], questions, model })
    expect(raws).toHaveLength(2)
    const client = createSystemOneClient({ url, batch: true, defaultModel: model })
    const results = await client.predictBatch({ states: [BILLING, CRASH, THANKS], questions })
    expect(results).toHaveLength(3)
    for (const result of results) {
      expectWellFormed(result)
    }
  })
})
