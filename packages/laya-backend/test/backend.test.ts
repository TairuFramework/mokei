import { fileURLToPath } from 'node:url'
import {
  createSystemOneClient,
  SystemOneError,
  SystemOneResponseError,
  type SystemOneResult,
} from '@mokei/system-one-client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaDaemonBackend, type LayaDaemonBackendParams } from '../src/backend.js'

const FAKE_LAYA = fileURLToPath(new URL('./fixtures/fake-laya.mjs', import.meta.url))
const questions = { dept: { type: 'choice', criteria: { billing: 'x', tech: 'y' } } } as const

type FakeResult = SystemOneResult & { route: string; pid: number; argv: Array<string> }

const backends: Array<LayaDaemonBackend> = []

function makeBackend(params: Partial<LayaDaemonBackendParams> = {}): LayaDaemonBackend {
  const backend = new LayaDaemonBackend({ model: 'fake.gguf', binary: FAKE_LAYA, ...params })
  backends.push(backend)
  return backend
}

async function predict(
  backend: LayaDaemonBackend,
  state: string,
  signal?: AbortSignal,
): Promise<FakeResult> {
  return (await backend.predict({ state, questions, model: 'laya', signal })) as FakeResult
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map((backend) => backend.close()))
  vi.unstubAllEnvs()
})

describe('LayaDaemonBackend', () => {
  test('the constructor requires model or modelsDir', () => {
    expect(() => new LayaDaemonBackend({})).toThrow(SystemOneError)
  })

  test('predict returns the daemon result without its id', async () => {
    const result = await predict(makeBackend(), 'hello')
    expect(result.model).toBe('laya')
    expect(result.route).toBe('hello')
    expect(result).not.toHaveProperty('id')
    expect(result.answers.dept).toMatchObject({ type: 'choice', choice: 'billing' })
  })

  test('passes the model and flags to laya daemon', async () => {
    const backend = makeBackend({ model: 'm.gguf', family: 'english', device: 'cpu', threads: 2 })
    const result = await predict(backend, 'a')
    expect(result.argv).toEqual([
      'daemon',
      'm.gguf',
      '--family',
      'english',
      '--device',
      'cpu',
      '--threads',
      '2',
    ])
  })

  test('passes a models directory instead of a model', async () => {
    const backend = makeBackend({ model: undefined, modelsDir: 'models' })
    expect((await predict(backend, 'a')).argv).toEqual(['daemon', '--models-dir', 'models'])
  })

  test('starts one process for concurrent first calls', async () => {
    const backend = makeBackend()
    const results = await Promise.all([
      predict(backend, 'a'),
      predict(backend, 'b'),
      predict(backend, 'c'),
    ])
    expect(new Set(results.map((r) => r.pid)).size).toBe(1)
  })

  test('routes each response to its own call', async () => {
    const backend = makeBackend()
    const results = await Promise.all([predict(backend, 'slow:50'), predict(backend, 'b')])
    expect(results.map((r) => r.route)).toEqual(['slow:50', 'b'])
  })

  test('a daemon error rejects with SystemOneResponseError and the daemon keeps serving', async () => {
    const backend = makeBackend()
    await expect(predict(backend, 'error')).rejects.toThrow(SystemOneResponseError)
    expect((await predict(backend, 'after')).route).toBe('after')
  })

  test('an error without an id and a non-JSON line reject the oldest call', async () => {
    const backend = makeBackend()
    const [noID, invalid, ok] = await Promise.allSettled([
      predict(backend, 'error-no-id'),
      predict(backend, 'invalid'),
      predict(backend, 'ok'),
    ])
    expect(noID.status === 'rejected' && noID.reason).toBeInstanceOf(SystemOneResponseError)
    expect(invalid.status === 'rejected' && invalid.reason).toBeInstanceOf(SystemOneResponseError)
    expect(ok.status === 'fulfilled' && ok.value.route).toBe('ok')
  })

  test('an aborted call rejects at once and its late response reaches no other call', async () => {
    const backend = makeBackend()
    await predict(backend, 'warm')
    const controller = new AbortController()
    const slow = predict(backend, 'slow:100', controller.signal)
    const next = predict(backend, 'next')
    controller.abort()
    await expect(slow).rejects.toMatchObject({ name: 'AbortError' })
    expect((await next).route).toBe('next')
  })

  test('an already-aborted signal rejects without a request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(predict(makeBackend(), 'a', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  test('listModels names the GGUF, or the models directory', async () => {
    expect(await makeBackend({ model: '/models/laya_english_f16.gguf' }).listModels()).toEqual([
      { name: 'laya_english_f16.gguf' },
    ])
    expect(await makeBackend({ model: undefined, modelsDir: '/models' }).listModels()).toEqual([
      { name: '/models' },
    ])
  })

  test('SystemOneClient runs predictBatch over the daemon', async () => {
    const client = createSystemOneClient({ backend: makeBackend(), defaultModel: 'laya' })
    const results = await client.predictBatch({ states: ['a', 'b', 'c'], questions })
    expect(results.map((r) => r.extras?.route)).toEqual(['a', 'b', 'c'])
    expect(results.every((r) => r.answers.dept.choice === 'billing')).toBe(true)
  })
})
