import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElicitResult } from '@mokei/context-protocol'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  type AskRequest,
  type AskResult,
  type BackendCallOptions,
  type BackendName,
  createDesktopElicitHandler,
  type DesktopBackend,
  type DesktopElicitHandler,
  type DesktopElicitOptions,
  type DesktopElicitRequest,
  type Runner,
} from '../src/index.js'

// Real executables on a private PATH so detection finds every backend.
const binDir = mkdtempSync(join(tmpdir(), 'mokei-host-desktop-'))
for (const name of ['alerter', 'osascript', 'zenity', 'notify-send']) {
  const path = join(binDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true })
})

const LINUX_ENV = { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }

type Call = {
  backend: BackendName
  request: AskRequest
  options: BackendCallOptions
  resolve: (result: AskResult) => void
  reject: (reason: unknown) => void
}

function fakeBackends() {
  const calls: Array<Call> = []
  const createBackend = (name: BackendName): DesktopBackend => ({
    name,
    ask(request, options) {
      return new Promise<AskResult>((resolve, reject) => {
        calls.push({ backend: name, request, options, resolve, reject })
      })
    },
  })
  return { calls, createBackend }
}

function fakeRunner(): Runner & { disposed: boolean } {
  const runner = {
    disposed: false,
    run: () => Promise.reject(new Error('fake runner does not run')),
    dispose: async () => {
      runner.disposed = true
    },
  }
  return runner
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve()
  }
}

function form(
  properties: Record<string, unknown>,
  required: Array<string> = Object.keys(properties),
): DesktopElicitRequest['params'] {
  return {
    message: 'Please answer',
    requestedSchema: { type: 'object', properties, required },
  } as unknown as DesktopElicitRequest['params']
}

function request(
  params: DesktopElicitRequest['params'] = form({ name: { type: 'string' } }),
  signal: AbortSignal = new AbortController().signal,
): DesktopElicitRequest {
  return { key: 'ctx', params, signal }
}

type Settled = { result?: ElicitResult; error?: unknown; done: boolean }
function track(promise: Promise<ElicitResult>): Settled {
  const settled: Settled = { done: false }
  promise.then(
    (result) => {
      settled.result = result
      settled.done = true
    },
    (error) => {
      settled.error = error
      settled.done = true
    },
  )
  return settled
}

describe('desktop elicit handler (blocking)', () => {
  let fake: ReturnType<typeof fakeBackends>
  let reports: Array<string>
  let handler: DesktopElicitHandler | undefined

  function create(options: Partial<DesktopElicitOptions> = {}): DesktopElicitHandler {
    handler = createDesktopElicitHandler({
      platform: 'linux',
      env: LINUX_ENV,
      runner: fakeRunner(),
      createBackend: fake.createBackend,
      onUnsupported: (reason) => reports.push(reason),
      ...options,
    })
    return handler
  }

  function call(index: number): Call {
    const found = fake.calls[index]
    if (found == null) throw new Error(`No backend call at ${index}`)
    return found
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fake = fakeBackends()
    reports = []
  })
  afterEach(async () => {
    await handler?.dispose().catch(() => {})
    handler = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('result mapping', () => {
    test('every dialog answered gives accept with content', async () => {
      const h = create()
      const params = form({
        name: { type: 'string' },
        age: { type: 'integer' },
        ok: { type: 'boolean' },
      })
      const settled = track(h(request(params)))
      await flush()
      call(0).resolve({ status: 'answered', value: 'Ada' })
      await flush()
      call(1).resolve({ status: 'answered', value: '36' })
      await flush()
      call(2).resolve({ status: 'answered', value: false })
      await flush()
      expect(settled.result).toEqual({
        action: 'accept',
        content: { name: 'Ada', age: 36, ok: false },
      })
      expect(fake.calls.map((c) => c.backend)).toEqual(['zenity', 'zenity', 'zenity'])
      expect(call(0).request.kind).toBe('text')
      expect(call(0).request.title).toBe('mokei')
      expect(call(0).request.text).toContain('ctx')
      expect(call(2).request.kind).toBe('confirm')
      expect(reports).toEqual([])
    })

    test('an optional empty text answer is left out of content', async () => {
      const h = create()
      const settled = track(h(request(form({ note: { type: 'string' } }, []))))
      await flush()
      call(0).resolve({ status: 'answered', value: '' })
      await flush()
      expect(settled.result).toEqual({ action: 'accept', content: {} })
    })

    test('dismissed gives cancel', async () => {
      const h = create()
      const settled = track(h(request()))
      await flush()
      call(0).resolve({ status: 'dismissed' })
      await flush()
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('a native timeout gives cancel', async () => {
      const h = create()
      const settled = track(h(request()))
      await flush()
      call(0).resolve({ status: 'timeout' })
      await flush()
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('declined gives decline', async () => {
      const h = create()
      const settled = track(h(request()))
      await flush()
      call(0).resolve({ status: 'declined' })
      await flush()
      expect(settled.result).toEqual({ action: 'decline' })
    })

    test('a violation re-asks with the violation on the first line', async () => {
      const h = create()
      const settled = track(h(request(form({ n: { type: 'integer', minimum: 5 } }))))
      await flush()
      call(0).resolve({ status: 'answered', value: '2' })
      await flush()
      expect(fake.calls).toHaveLength(2)
      expect(call(1).request.text.split('\n')[0]).toBe('must satisfy minimum 5')
      call(1).resolve({ status: 'answered', value: '7' })
      await flush()
      expect(settled.result).toEqual({ action: 'accept', content: { n: 7 } })
    })

    test('three violations give cancel', async () => {
      const h = create()
      const settled = track(h(request(form({ n: { type: 'integer' } }))))
      for (let i = 0; i < 3; i++) {
        await flush()
        call(i).resolve({ status: 'answered', value: 'x' })
      }
      await flush()
      expect(fake.calls).toHaveLength(3)
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('empty properties: one confirm, yes gives accept with empty content', async () => {
      const h = create()
      const settled = track(h(request(form({}))))
      await flush()
      expect(call(0).request.kind).toBe('confirm')
      expect(call(0).request.text).toContain('Please answer')
      call(0).resolve({ status: 'answered', value: true })
      await flush()
      expect(settled.result).toEqual({ action: 'accept', content: {} })
    })

    test('empty properties: no gives cancel', async () => {
      const h = create()
      const settled = track(h(request(form({}))))
      await flush()
      call(0).resolve({ status: 'answered', value: false })
      await flush()
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('empty properties: dismissed gives cancel', async () => {
      const h = create()
      const settled = track(h(request(form({}))))
      await flush()
      call(0).resolve({ status: 'dismissed' })
      await flush()
      expect(settled.result).toEqual({ action: 'cancel' })
    })
  })

  describe('backend failure', () => {
    test('an ENOENT throw gives cancel and one report, no rejection', async () => {
      const h = create()
      const settled = track(h(request()))
      await flush()
      const error = Object.assign(new Error('spawn zenity ENOENT'), { code: 'ENOENT' })
      call(0).reject(error)
      await flush()
      expect(settled.error).toBeUndefined()
      expect(settled.result).toEqual({ action: 'cancel' })
      expect(reports).toEqual(['spawn zenity ENOENT'])
    })

    test('an unexpected exit error gives cancel and reports its message', async () => {
      const h = create()
      const settled = track(h(request()))
      await flush()
      call(0).reject(new Error('Gtk-WARNING: cannot open display'))
      await flush()
      expect(settled.result).toEqual({ action: 'cancel' })
      expect(reports).toEqual(['Gtk-WARNING: cannot open display'])
    })
  })

  describe('queue', () => {
    test('FIFO: the second dialog opens only after the first settles', async () => {
      const h = create()
      const first = track(h(request()))
      const second = track(h(request(form({ other: { type: 'string' } }))))
      await flush()
      expect(fake.calls).toHaveLength(1)
      call(0).resolve({ status: 'answered', value: 'one' })
      await flush()
      expect(first.result).toEqual({ action: 'accept', content: { name: 'one' } })
      expect(fake.calls).toHaveLength(2)
      expect(call(1).request.text).toContain('other')
      call(1).resolve({ status: 'answered', value: 'two' })
      await flush()
      expect(second.result).toEqual({ action: 'accept', content: { other: 'two' } })
    })

    test('the next dialog waits until an aborted dialog has settled', async () => {
      const h = create()
      const controller = new AbortController()
      const first = track(h(request(undefined, controller.signal)))
      const second = track(h(request(form({ other: { type: 'string' } }))))
      await flush()
      const reason = new Error('stop')
      controller.abort(reason)
      await flush()
      // The caller gets its rejection at once, but the killed dialog has not exited yet
      expect(first.error).toBe(reason)
      expect(fake.calls).toHaveLength(1)
      call(0).reject(reason)
      await flush()
      expect(fake.calls).toHaveLength(2)
      call(1).resolve({ status: 'answered', value: 'two' })
      await flush()
      expect(second.result).toEqual({ action: 'accept', content: { other: 'two' } })
    })

    test('a request aborted while queued leaves the queue and rejects with the reason', async () => {
      const h = create()
      const first = track(h(request()))
      const controller = new AbortController()
      const second = track(h(request(undefined, controller.signal)))
      const third = track(h(request()))
      await flush()
      const reason = new Error('caller gave up')
      controller.abort(reason)
      await flush()
      expect(second.error).toBe(reason)
      call(0).resolve({ status: 'answered', value: 'a' })
      await flush()
      expect(first.result).toEqual({ action: 'accept', content: { name: 'a' } })
      // The aborted request never opened a dialog; the third is next.
      expect(fake.calls).toHaveLength(2)
      call(1).resolve({ status: 'answered', value: 'c' })
      await flush()
      expect(third.result).toEqual({ action: 'accept', content: { name: 'c' } })
    })
  })

  describe('abort', () => {
    test('an abort while open kills the dialog and rejects with the reason', async () => {
      const h = create()
      const controller = new AbortController()
      const settled = track(h(request(undefined, controller.signal)))
      await flush()
      const reason = new Error('stop')
      controller.abort(reason)
      await flush()
      expect(call(0).options.signal.aborted).toBe(true)
      expect(settled.error).toBe(reason)
      expect(reports).toEqual([])
    })

    test('an already-aborted signal rejects at once and opens no dialog', async () => {
      const h = create()
      const reason = new Error('already')
      const promise = h(request(undefined, AbortSignal.abort(reason)))
      await expect(promise).rejects.toBe(reason)
      await flush()
      expect(fake.calls).toHaveLength(0)
    })
  })

  describe('budget', () => {
    test('each backend call gets the remaining budget', async () => {
      const h = create()
      track(h(request(form({ a: { type: 'string' }, b: { type: 'string' } }))))
      await flush()
      expect(call(0).options.timeoutMs).toBe(90_000)
      await vi.advanceTimersByTimeAsync(30_000)
      call(0).resolve({ status: 'answered', value: 'x' })
      await flush()
      expect(call(1).options.timeoutMs).toBe(60_000)
    })

    test('expiry while queued gives cancel at 90 s', async () => {
      const h = create()
      track(h(request()))
      const queued = track(h(request()))
      await vi.advanceTimersByTimeAsync(89_999)
      expect(queued.done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(queued.result).toEqual({ action: 'cancel' })
      // The first request's own budget also expired at 90 s; the queued one never opened.
      expect(fake.calls).toHaveLength(1)
    })

    test('expiry across two fields gives cancel at 90 s and kills the open dialog', async () => {
      const h = create()
      const settled = track(h(request(form({ a: { type: 'string' }, b: { type: 'string' } }))))
      await vi.advanceTimersByTimeAsync(50_000)
      call(0).resolve({ status: 'answered', value: 'x' })
      await vi.advanceTimersByTimeAsync(39_999)
      expect(settled.done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(call(1).options.signal.aborted).toBe(true)
      expect(settled.result).toEqual({ action: 'cancel' })
      expect(reports).toEqual([])
    })

    test('expiry across violation retries gives cancel at 90 s', async () => {
      const h = create()
      const settled = track(h(request(form({ n: { type: 'integer' } }))))
      await vi.advanceTimersByTimeAsync(40_000)
      call(0).resolve({ status: 'answered', value: 'x' })
      await vi.advanceTimersByTimeAsync(40_000)
      call(1).resolve({ status: 'answered', value: 'y' })
      await flush()
      expect(call(2).options.timeoutMs).toBe(10_000)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(settled.done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('timeoutSeconds is clamped to maxTimeoutSeconds', async () => {
      const h = create({ timeoutSeconds: 1000, maxTimeoutSeconds: 20 })
      const settled = track(h(request()))
      await flush()
      expect(call(0).options.timeoutMs).toBe(20_000)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('the default clamp is 600 seconds', async () => {
      const h = create({ timeoutSeconds: 3600 })
      track(h(request()))
      await flush()
      expect(call(0).options.timeoutMs).toBe(600_000)
    })
  })

  describe('dispose', () => {
    test('rejects open and queued requests and later calls, and disposes an owned runner', async () => {
      const h = create({ runner: undefined })
      const open = track(h(request()))
      const queued = track(h(request()))
      await flush()
      await h.dispose()
      await flush()
      expect(call(0).options.signal.aborted).toBe(true)
      expect(open.error).toEqual(new Error('Desktop elicit handler disposed'))
      expect(queued.error).toEqual(new Error('Desktop elicit handler disposed'))
      await expect(h(request())).rejects.toThrow('Desktop elicit handler disposed')
      expect(fake.calls).toHaveLength(1)
    })

    test('does not dispose a runner it was given', async () => {
      const runner = fakeRunner()
      const h = create({ runner })
      await h.dispose()
      expect(runner.disposed).toBe(false)
    })
  })

  describe('declined without a dialog', () => {
    test('URL mode', async () => {
      const h = create()
      const params = {
        mode: 'url',
        message: 'Open this',
        url: 'https://example.com',
        elicitationId: 'e1',
      } as unknown as DesktopElicitRequest['params']
      await expect(h(request(params))).resolves.toEqual({ action: 'decline' })
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatch(/url/i)
      expect(fake.calls).toHaveLength(0)
    })

    test('an unsupported property kind', async () => {
      const h = create()
      const params = form({ tags: { type: 'array', items: { type: 'string', enum: ['a'] } } })
      await expect(h(request(params))).resolves.toEqual({ action: 'decline' })
      expect(reports).toEqual(['property "tags" has an unsupported kind'])
    })

    test('an invalid pattern declines without throwing', async () => {
      const h = create()
      const params = form({ code: { type: 'string', pattern: '(' } })
      await expect(h(request(params))).resolves.toEqual({ action: 'decline' })
      expect(reports).toEqual(['property "code" has an invalid pattern'])
      expect(fake.calls).toHaveLength(0)
    })

    test('no ask backend reports askProblem', async () => {
      const h = create({ env: { PATH: '' } })
      await expect(h(request())).resolves.toEqual({ action: 'decline' })
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatch(/No dialog backend found/)
    })

    test('a forced unavailable ask backend declines with a clear error', async () => {
      const h = create({ env: { PATH: '' }, backends: { ask: 'zenity' } })
      await expect(h(request())).resolves.toEqual({ action: 'decline' })
      expect(reports).toEqual(['Forced dialog backend zenity is unavailable: not on PATH'])
    })

    test('askBackendFor not ok: a comma label with forced alerter', async () => {
      const h = create({
        platform: 'darwin',
        env: { PATH: binDir },
        backends: { ask: 'alerter' },
      })
      const params = form({ pick: { type: 'string', enum: ['a', 'b'], enumNames: ['A, x', 'B'] } })
      await expect(h(request(params))).resolves.toEqual({ action: 'decline' })
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatch(/comma/)
      expect(fake.calls).toHaveLength(0)
    })

    test('askBackendFor not ok: a reply default starting with - with forced alerter', async () => {
      const h = create({
        platform: 'darwin',
        env: { PATH: binDir },
        backends: { ask: 'alerter' },
      })
      const params = form({ name: { type: 'string', default: '--appIcon' } })
      await expect(h(request(params))).resolves.toEqual({ action: 'decline' })
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatch(/starting with "-"/)
      expect(fake.calls).toHaveLength(0)
    })

    test('auto-selected alerter falls back to osascript for a label starting with -', async () => {
      const h = create({ platform: 'darwin', env: { PATH: binDir } })
      const params = form({
        pick: { type: 'string', enum: ['a', 'b'], enumNames: ['-timeout', 'B'] },
      })
      const pending = h(request(params))
      await flush()
      expect(fake.calls.map((c) => c.backend)).toEqual(['osascript'])
      fake.calls[0]?.resolve({ status: 'answered', value: 'a' })
      await expect(pending).resolves.toEqual({ action: 'accept', content: { pick: 'a' } })
      expect(reports).toEqual([])
    })

    test('without onUnsupported the report goes to console.error with the prefix', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const h = create({ onUnsupported: undefined, env: { PATH: '' } })
      await expect(h(request())).resolves.toEqual({ action: 'decline' })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[0]).toMatch(/^\[mokei\/host-desktop\] No dialog backend found/)
    })
  })

  describe('construction', () => {
    test('inbox mode without an inbox throws', () => {
      expect(() => createDesktopElicitHandler({ mode: 'inbox' })).toThrow(
        new TypeError('mode "inbox" requires an inbox'),
      )
    })

    test.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])(
      'an invalid timeout (%s) throws',
      (value) => {
        for (const name of ['timeoutSeconds', 'maxTimeoutSeconds'] as const) {
          expect(() => createDesktopElicitHandler({ [name]: value })).toThrow(
            new TypeError(`${name} must be a finite number greater than 0, got ${value}`),
          )
        }
      },
    )

    test('valid timeouts are accepted', () => {
      const h = createDesktopElicitHandler({ timeoutSeconds: 0.5, maxTimeoutSeconds: 1200 })
      return h.dispose()
    })
  })
})
