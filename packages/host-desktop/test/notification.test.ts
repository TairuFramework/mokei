import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, test, vi } from 'vitest'

import type {
  DesktopElicitOptions,
  NotifyCallOptions,
  NotifyRequest,
  Runner,
} from '../src/index.js'
import { createDesktopNotifier } from '../src/index.js'

const binDir = mkdtempSync(join(tmpdir(), 'mokei-notifier-'))
const binary = join(binDir, 'notify-send')
writeFileSync(binary, '#!/bin/sh\nexit 0\n')
chmodSync(binary, 0o755)
afterAll(() => rmSync(binDir, { recursive: true, force: true }))
const notifiers: Array<ReturnType<typeof createDesktopNotifier>> = []
afterEach(async () => {
  await Promise.all(notifiers.splice(0).map((notifier) => notifier.dispose()))
  vi.useRealTimers()
})
function create(options: DesktopElicitOptions = {}) {
  const calls: Array<{ request: NotifyRequest; options: NotifyCallOptions }> = []
  const notifier = createDesktopNotifier({
    platform: 'linux',
    env: { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' },
    createBackend: (name) => ({
      name,
      notify: async (request, options) => {
        calls.push({ request, options })
      },
    }),
    ...options,
  })
  notifiers.push(notifier)
  return { notifier, calls }
}
test('notifier delivers arbitrary generic messages with the existing notification budget', async () => {
  const { notifier, calls } = create({ appName: 'Flow' })
  await notifier.notify('2 pending prompts')
  expect(calls).toHaveLength(1)
  expect(calls[0]?.request).toEqual({ title: 'Flow', message: '2 pending prompts' })
  expect(calls[0]?.options.timeoutMs).toBe(5000)
})
test('missing notification backend and backend failure reject without retry', async () => {
  const unavailable = create({ env: { PATH: '' } }).notifier
  await expect(unavailable.notify('Pending')).rejects.toThrow('notification backend')
  const deliver = vi.fn(async () => {
    throw new Error('Delivery failed')
  })
  const { notifier } = create({ createBackend: (name) => ({ name, notify: deliver }) })
  await expect(notifier.notify('Pending')).rejects.toThrow('Delivery failed')
  expect(deliver).toHaveBeenCalledTimes(1)
})
test('caller abort rejects promptly and propagates to the backend', async () => {
  let signal: AbortSignal | undefined
  const { notifier } = create({
    createBackend: (name) => ({
      name,
      notify: (_request, options) => {
        signal = options.signal
        return new Promise((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true }),
        )
      },
    }),
  })
  const caller = new AbortController()
  const reason = new Error('Caller stopped')
  const result = expect(notifier.notify('Pending', { signal: caller.signal })).rejects.toBe(reason)
  caller.abort(reason)
  await result
  expect(signal?.aborted).toBe(true)
})
test('pre-aborted calls never reach a backend', async () => {
  const { notifier, calls } = create()
  await expect(
    notifier.notify('Pending', { signal: AbortSignal.abort(new Error('Stopped')) }),
  ).rejects.toThrow('Stopped')
  expect(calls).toEqual([])
})
test('notification timeout aborts delivery at five seconds', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const { notifier } = create({
    createBackend: (name) => ({
      name,
      notify: (_request, options) => {
        signal = options.signal
        return new Promise((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true }),
        )
      },
    }),
  })
  const result = expect(notifier.notify('Pending')).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(5000)
  await result
  expect(signal?.aborted).toBe(true)
})
test('dispose aborts delivery, waits for backend exit and preserves injected runner ownership', async () => {
  let exit!: () => void
  let signal: AbortSignal | undefined
  const runner: Runner = {
    run: async () => {
      throw new Error('Unexpected runner call')
    },
    dispose: vi.fn(async () => {}),
  }
  const { notifier } = create({
    runner,
    createBackend: (name) => ({
      name,
      notify: (_request, options) => {
        signal = options.signal
        return new Promise((resolve) => {
          exit = resolve
        })
      },
    }),
  })
  const result = expect(notifier.notify('Pending')).rejects.toThrow('disposed')
  let disposed = false
  const disposing = notifier.dispose()
  expect(notifier.dispose()).toBe(disposing)
  void disposing.then(() => {
    disposed = true
  })
  await result
  expect(signal?.aborted).toBe(true)
  expect(disposed).toBe(false)
  exit()
  await disposing
  expect(runner.dispose).not.toHaveBeenCalled()
  await expect(notifier.notify('Later')).rejects.toThrow('disposed')
})

test('input surface disposal cancels delivery without taking ownership of an injected backend', async () => {
  const { createDesktopInputSurface } = await import('../src/index.js')
  let exit!: () => void
  let signal: AbortSignal | undefined
  const runner: Runner = {
    run: async () => {
      throw new Error('Unexpected runner call')
    },
    dispose: vi.fn(async () => {}),
  }
  const surface = createDesktopInputSurface({
    platform: 'linux',
    env: { PATH: binDir, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' },
    runner,
    createBackend: (name) => ({
      name,
      notify: (_request, options) => {
        signal = options.signal
        return new Promise((resolve) => {
          exit = resolve
        })
      },
    }),
  })
  const delivery = surface.notify({
    params: { message: 'Input', requestedSchema: { type: 'object', properties: {} } },
    signal: new AbortController().signal,
  })
  const done = vi.fn()
  const disposing = surface.dispose().then(done)
  try {
    await delivery
    expect(signal?.aborted).toBe(true)
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 100 })
    expect(runner.dispose).not.toHaveBeenCalled()
  } finally {
    exit()
    await disposing
  }
})

test('click, group and lifetime reach the backend, and dispose removes live notifications', async () => {
  const { notifier, calls } = create()
  const onClick = vi.fn()
  await notifier.notify('Pending', { group: 'item-1', onClick })
  const options = calls[0]?.options
  expect(options?.group).toBe('item-1')
  expect(options?.lifetime?.aborted).toBe(false)
  options?.onClick?.()
  expect(onClick).toHaveBeenCalledTimes(1)
  await notifier.dispose()
  expect(options?.lifetime?.aborted).toBe(true)
  // A click racing disposal is not forwarded
  options?.onClick?.()
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('caller abort after delivery removes the notification and drops its click', async () => {
  const { notifier, calls } = create()
  const onClick = vi.fn()
  const caller = new AbortController()
  await notifier.notify('Pending', { signal: caller.signal, onClick })
  const options = calls[0]?.options
  caller.abort(new Error('Settled'))
  expect(options?.lifetime?.aborted).toBe(true)
  options?.onClick?.()
  expect(onClick).not.toHaveBeenCalled()
})

test('a throwing click handler is reported, not thrown', async () => {
  const reports: Array<string> = []
  const { notifier, calls } = create({ onUnsupported: (reason) => reports.push(reason) })
  await notifier.notify('Pending', {
    onClick: () => {
      throw new Error('Boom')
    },
  })
  expect(() => calls[0]?.options.onClick?.()).not.toThrow()
  expect(reports).toEqual(['Notification click handler failed: Boom'])
})

test('darwin prefers alerter and falls back to osascript for an option-like message', async () => {
  const darwinBin = mkdtempSync(join(tmpdir(), 'mokei-notifier-darwin-'))
  try {
    for (const name of ['alerter', 'osascript']) {
      writeFileSync(join(darwinBin, name), '#!/bin/sh\nexit 0\n')
      chmodSync(join(darwinBin, name), 0o755)
    }
    const used: Array<string> = []
    const { notifier } = create({
      platform: 'darwin',
      env: { PATH: darwinBin },
      createBackend: (name) => ({
        name,
        notify: async () => {
          used.push(name)
        },
      }),
    })
    await notifier.notify('Pending')
    await notifier.notify('-x')
    expect(used).toEqual(['alerter', 'osascript'])
  } finally {
    rmSync(darwinBin, { recursive: true, force: true })
  }
})
