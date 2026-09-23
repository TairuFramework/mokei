import { fileURLToPath } from 'node:url'
import { SystemOneConnectionError, type SystemOneResult } from '@mokei/system-one-client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaDaemonBackend, type LayaDaemonBackendParams } from '../src/backend.js'

const FAKE_LAYA = fileURLToPath(new URL('./fixtures/fake-laya.mjs', import.meta.url))
const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

type FakeResult = SystemOneResult & { route: string; pid: number }

const backends: Array<LayaDaemonBackend> = []

function makeBackend(params: Partial<LayaDaemonBackendParams> = {}): LayaDaemonBackend {
  const backend = new LayaDaemonBackend({ model: 'fake.gguf', binary: FAKE_LAYA, ...params })
  backends.push(backend)
  return backend
}

async function predict(backend: LayaDaemonBackend, state: string): Promise<FakeResult> {
  return (await backend.predict({ state, questions, model: 'laya' })) as FakeResult
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map((backend) => backend.close()))
  vi.unstubAllEnvs()
})

describe('LayaDaemonBackend lifecycle', () => {
  test('a crash rejects the in-flight and queued calls, and the next call restarts', async () => {
    const backend = makeBackend()
    const { pid } = await predict(backend, 'warm')
    const [crashed, queued] = await Promise.allSettled([
      predict(backend, 'crash'),
      predict(backend, 'queued'),
    ])
    expect(crashed.status).toBe('rejected')
    const reason = crashed.status === 'rejected' ? crashed.reason : undefined
    expect(reason).toBeInstanceOf(SystemOneConnectionError)
    expect(String(reason)).toContain('code 3')
    expect(String(reason)).toContain('decide failed')
    expect(queued.status === 'rejected' && queued.reason).toBeInstanceOf(SystemOneConnectionError)
    const next = await predict(backend, 'next')
    expect(next.route).toBe('next')
    expect(next.pid).not.toBe(pid)
  })

  test('an exit before ready rejects with the stderr text', async () => {
    vi.stubEnv('FAKE_LAYA_START', 'fail')
    const call = predict(makeBackend(), 'a')
    await expect(call).rejects.toThrow(SystemOneConnectionError)
    await expect(call).rejects.toThrow('failed to load missing.gguf')
  })

  test('a failed start is retried on the next call', async () => {
    vi.stubEnv('FAKE_LAYA_START', 'fail')
    const backend = makeBackend()
    await expect(predict(backend, 'a')).rejects.toThrow(SystemOneConnectionError)
    vi.stubEnv('FAKE_LAYA_START', 'ok')
    expect((await predict(backend, 'b')).route).toBe('b')
  })

  test('a missing binary rejects with SystemOneConnectionError', async () => {
    const backend = makeBackend({ binary: '/nonexistent/laya' })
    await expect(predict(backend, 'a')).rejects.toThrow(SystemOneConnectionError)
  })

  test('the startup timeout rejects and kills the process', async () => {
    vi.stubEnv('FAKE_LAYA_START', 'hang')
    const call = predict(makeBackend({ startupTimeoutMs: 300 }), 'a')
    await expect(call).rejects.toThrow(SystemOneConnectionError)
    await expect(call).rejects.toThrow('not ready after 300ms')
    await expect(call).rejects.toThrow('loading model')
    const message = await call.then(
      () => '',
      (error: unknown) => String(error),
    )
    const pid = Number(/pid (\d+)/.exec(message)?.[1])
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false), { timeout: 2_000 })
  })

  test('close() ends the process, lets queued calls finish, and a later call restarts', async () => {
    const backend = makeBackend()
    const { pid } = await predict(backend, 'warm')
    const queued = predict(backend, 'slow:50')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await backend.close()
    expect((await queued).route).toBe('slow:50')
    expect(isRunning(pid)).toBe(false)
    const next = await predict(backend, 'after')
    expect(next.pid).not.toBe(pid)
  })

  test('close() before any call resolves', async () => {
    await expect(makeBackend().close()).resolves.toBeUndefined()
  })
})
