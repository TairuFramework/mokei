import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskInputWithdrawnError } from '@mokei/context-client'
import type { ElicitResult } from '@mokei/context-protocol'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  type AskRequest,
  type AskResult,
  type BackendCallOptions,
  type BackendName,
  createDesktopElicitHandler,
  createInputInbox,
  type DesktopBackend,
  type DesktopElicitHandler,
  type DesktopElicitOptions,
  type DesktopElicitRequest,
  type InputInbox,
  type NotifyRequest,
  type Runner,
} from '../src/index.js'

// Real executables on a private PATH so detection finds every backend.
const binDir = mkdtempSync(join(tmpdir(), 'mokei-host-desktop-inbox-'))
for (const name of ['alerter', 'osascript', 'zenity', 'notify-send']) {
  const path = join(binDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true })
})

const LINUX_ENV = { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }

type AskCall = {
  request: AskRequest
  options: BackendCallOptions
  resolve: (result: AskResult) => void
  reject: (reason: unknown) => void
}
type NotifyCall = {
  backend: BackendName
  request: NotifyRequest
  options: BackendCallOptions
  resolve: () => void
  reject: (reason: unknown) => void
}

function fakeBackends(log: Array<string>) {
  const asks: Array<AskCall> = []
  const notifies: Array<NotifyCall> = []
  const createBackend = (name: BackendName): DesktopBackend => ({
    name,
    ask(request, options) {
      return new Promise<AskResult>((resolve, reject) => {
        asks.push({ request, options, resolve, reject })
      })
    },
    notify(request, options) {
      log.push('notify')
      return new Promise<void>((resolve, reject) => {
        notifies.push({ backend: name, request, options, resolve, reject })
      })
    },
  })
  return { asks, notifies, createBackend }
}

function fakeRunner(): Runner {
  return {
    run: () => Promise.reject(new Error('fake runner does not run')),
    dispose: async () => {},
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve()
  }
}

const NAME_FORM = {
  message: 'Please answer',
  requestedSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
} as unknown as DesktopElicitRequest['params']

function request(
  params: DesktopElicitRequest['params'] = NAME_FORM,
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

describe('desktop elicit handler (inbox)', () => {
  let log: Array<string>
  let fake: ReturnType<typeof fakeBackends>
  let reports: Array<string>
  let inbox: InputInbox
  let handler: DesktopElicitHandler | undefined

  function create(options: Partial<DesktopElicitOptions> = {}): DesktopElicitHandler {
    handler = createDesktopElicitHandler({
      mode: 'inbox',
      inbox,
      platform: 'linux',
      env: LINUX_ENV,
      runner: fakeRunner(),
      createBackend: fake.createBackend,
      onUnsupported: (reason) => reports.push(reason),
      ...options,
    })
    return handler
  }

  function onlyEntryId(): string {
    const [entry] = inbox.list()
    if (entry == null) throw new Error('No pending entry')
    return entry.id
  }

  beforeEach(() => {
    vi.useFakeTimers()
    log = []
    fake = fakeBackends(log)
    reports = []
    inbox = createInputInbox()
  })
  afterEach(async () => {
    await handler?.dispose().catch(() => {})
    handler = undefined
    inbox.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('without an entry', () => {
    test('no answer surface reports and returns cancel without an entry', async () => {
      const h = create()
      const added = vi.fn()
      inbox.events.on('added', added)
      await expect(h(request())).resolves.toEqual({ action: 'cancel' })
      expect(reports).toEqual(['No input answer surface is registered; cancelling input from ctx'])
      expect(inbox.list()).toEqual([])
      expect(added).not.toHaveBeenCalled()
      expect(fake.notifies).toHaveLength(0)
    })

    test('no answer surface logs to stderr without onUnsupported', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const h = create({ onUnsupported: undefined })
      await expect(h(request())).resolves.toEqual({ action: 'cancel' })
      expect(error).toHaveBeenCalledWith(
        '[mokei/host-desktop] No input answer surface is registered; cancelling input from ctx',
      )
    })

    test('URL mode declines and reports without an entry', async () => {
      inbox.registerAnswerSurface()
      const h = create()
      const params = {
        mode: 'url',
        message: 'Open',
        url: 'https://example.com',
        elicitationId: 'e1',
      } as unknown as DesktopElicitRequest['params']
      await expect(h(request(params))).resolves.toEqual({ action: 'decline' })
      expect(reports).toHaveLength(1)
      expect(inbox.list()).toEqual([])
      expect(fake.notifies).toHaveLength(0)
    })
  })

  describe('adding and notifying', () => {
    test('added fires before the notification starts; answerable while delivery is in flight', async () => {
      inbox.registerAnswerSurface()
      inbox.events.on('added', () => {
        log.push('added')
      })
      const h = create()
      const settled = track(h(request()))
      await flush()
      expect(log).toEqual(['added', 'notify'])
      expect(fake.notifies).toHaveLength(1)
      expect(inbox.answer(onlyEntryId(), { name: 'Ada' })).toBe(true)
      await flush()
      expect(settled.result).toEqual({ action: 'accept', content: { name: 'Ada' } })
      expect(reports).toEqual([])
    })

    test('the notification is generic by default with a 5-second timeout', async () => {
      inbox.registerAnswerSurface()
      const h = create({ appName: 'Laya' })
      track(h(request()))
      await flush()
      const [notify] = fake.notifies
      expect(notify?.backend).toBe('notify-send')
      expect(notify?.request).toEqual({ title: 'Laya', message: 'ctx needs your input' })
      expect(notify?.options.timeoutMs).toBe(5000)
    })

    test('the prompt preview is appended only with explicit opt-in', async () => {
      inbox.registerAnswerSurface()
      const long = 'x'.repeat(250)
      const params = { ...NAME_FORM, message: long } as DesktopElicitRequest['params']
      const h = create({ notificationPromptPreview: true })
      track(h(request(params)))
      await flush()
      expect(fake.notifies[0]?.request.message).toBe(`ctx needs your input: ${'x'.repeat(200)}`)
    })

    test('a failed notification is reported and the entry stays', async () => {
      inbox.registerAnswerSurface()
      const h = create()
      const settled = track(h(request()))
      await flush()
      fake.notifies[0]?.reject(new Error('dbus down'))
      await flush()
      expect(reports).toHaveLength(1)
      expect(reports[0]).toContain('dbus down')
      expect(inbox.list()).toHaveLength(1)
      expect(settled.done).toBe(false)
    })

    test('failures log to stderr without onUnsupported', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      inbox.registerAnswerSurface()
      const h = create({ onUnsupported: undefined })
      track(h(request()))
      await flush()
      fake.notifies[0]?.reject(new Error('dbus down'))
      await flush()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('dbus down')
      expect(inbox.list()).toHaveLength(1)
    })

    test('a notification that never finishes is reported after 5 seconds and the entry stays', async () => {
      inbox.registerAnswerSurface()
      const h = create()
      const settled = track(h(request()))
      await flush()
      await vi.advanceTimersByTimeAsync(4999)
      expect(reports).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toContain('timed out')
      expect(fake.notifies[0]?.options.signal.aborted).toBe(true)
      expect(inbox.list()).toHaveLength(1)
      expect(settled.done).toBe(false)
    })

    test('an unavailable forced notify backend is reported and the entry stays', async () => {
      inbox.registerAnswerSurface()
      const h = create({ backends: { notify: 'osascript' } })
      const settled = track(h(request()))
      await flush()
      expect(fake.notifies).toHaveLength(0)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toContain('Forced notify backend osascript is unavailable')
      expect(inbox.list()).toHaveLength(1)
      expect(settled.done).toBe(false)
    })

    test('a missing notify backend is reported and the entry stays', async () => {
      inbox.registerAnswerSurface()
      const h = create({ env: { PATH: binDir, DISPLAY: ':0' } })
      track(h(request()))
      await flush()
      expect(fake.notifies).toHaveLength(0)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toContain('No notification backend found')
      expect(inbox.list()).toHaveLength(1)
    })

    test('unregistering the last surface while notifying settles cancel and removes the entry', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const unregister = inbox.registerAnswerSurface()
      const h = create()
      const settled = track(h(request()))
      await flush()
      expect(fake.notifies).toHaveLength(1)
      unregister()
      await flush()
      expect(settled.result).toEqual({ action: 'cancel' })
      expect(inbox.list()).toEqual([])
    })
  })

  describe('prompting', () => {
    test('a supported form can be prompted and the dialog answer settles the entry', async () => {
      inbox.registerAnswerSurface()
      const h = create()
      const settled = track(h(request()))
      await flush()
      const id = onlyEntryId()
      expect(inbox.get(id)?.canPrompt).toBe(true)
      const prompted = track(inbox.prompt(id))
      await flush()
      expect(fake.asks).toHaveLength(1)
      fake.asks[0]?.resolve({ status: 'answered', value: 'Ada' })
      await flush()
      const accept = { action: 'accept', content: { name: 'Ada' } }
      expect(prompted.result).toEqual(accept)
      expect(settled.result).toEqual(accept)
    })

    test('a form the dialogs cannot show is added with canPrompt false', async () => {
      inbox.registerAnswerSurface()
      const params = {
        message: 'Pick',
        requestedSchema: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } },
        },
      } as unknown as DesktopElicitRequest['params']
      const h = create()
      const settled = track(h(request(params)))
      await flush()
      expect(inbox.get(onlyEntryId())?.canPrompt).toBe(false)
      expect(reports).toEqual([])
      expect(settled.done).toBe(false)
    })

    test('a pending entry outlives 90 seconds and a later prompt gets a fresh 90-second budget', async () => {
      inbox.registerAnswerSurface()
      const h = create()
      const settled = track(h(request()))
      await flush()
      fake.notifies[0]?.resolve()
      await vi.advanceTimersByTimeAsync(91_000)
      const id = onlyEntryId()
      expect(settled.done).toBe(false)

      await vi.advanceTimersByTimeAsync(9_000) // 100 s
      const prompted = track(inbox.prompt(id))
      await flush()
      expect(fake.asks).toHaveLength(1)
      expect(fake.asks[0]?.options.timeoutMs).toBe(90_000)

      await vi.advanceTimersByTimeAsync(89_999)
      expect(prompted.done).toBe(false)
      await vi.advanceTimersByTimeAsync(1) // 190 s
      expect(fake.asks[0]?.options.signal.aborted).toBe(true)
      expect(prompted.result).toEqual({ action: 'cancel' })
      expect(settled.result).toEqual({ action: 'cancel' })
    })

    test('an external answer closes an open prompt dialog', async () => {
      inbox.registerAnswerSurface()
      const h = create()
      track(h(request()))
      await flush()
      const id = onlyEntryId()
      track(inbox.prompt(id))
      await flush()
      inbox.decline(id)
      await flush()
      expect(fake.asks[0]?.options.signal.aborted).toBe(true)
    })

    test('a request abort closes an open prompt dialog', async () => {
      inbox.registerAnswerSurface()
      const controller = new AbortController()
      const h = create()
      const settled = track(h(request(undefined, controller.signal)))
      await flush()
      track(inbox.prompt(onlyEntryId()))
      await flush()
      const reason = new Error('stop')
      controller.abort(reason)
      await flush()
      expect(fake.asks[0]?.options.signal.aborted).toBe(true)
      expect(settled.error).toBe(reason)
    })
  })

  describe('prompt outcomes no person chose', () => {
    const ChoiceForm = (label: string) =>
      ({
        message: 'Pick',
        requestedSchema: {
          type: 'object',
          properties: { pick: { type: 'string', oneOf: [{ const: 'a', title: label }] } },
          required: ['pick'],
        },
      }) as unknown as DesktopElicitRequest['params']

    async function expectPendingAfterRejectedPrompt(settled: Settled): Promise<void> {
      const id = onlyEntryId()
      const prompted = track(inbox.prompt(id))
      await flush()
      expect(prompted.error).toBeInstanceOf(Error)
      expect(inbox.get(id)).toBeDefined()
      expect(settled.done).toBe(false)
    }

    test('no dialog backend: canPrompt is false, prompt rejects and the entry stays pending', async () => {
      inbox.registerAnswerSurface()
      // notify-send is available, zenity is not (no DISPLAY)
      const h = create({ env: { PATH: binDir, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' } })
      const settled = track(h(request()))
      await flush()
      expect(inbox.get(onlyEntryId())?.canPrompt).toBe(false)
      await expectPendingAfterRejectedPrompt(settled)
      expect(fake.asks).toHaveLength(0)
      // The application can still answer through its own surface
      expect(inbox.decline(onlyEntryId())).toBe(true)
      await flush()
      expect(settled.result).toEqual({ action: 'decline' })
    })

    test.each([
      ['a missing binary', 'spawn zenity ENOENT'],
      ['an unknown exit code', 'zenity exited with code 42'],
    ])(
      'a backend failure (%s) rejects the prompt and leaves the entry pending',
      async (_, message) => {
        inbox.registerAnswerSurface()
        const h = create()
        const settled = track(h(request()))
        await flush()
        const id = onlyEntryId()
        expect(inbox.get(id)?.canPrompt).toBe(true)
        const prompted = track(inbox.prompt(id))
        await flush()
        fake.asks[0]?.reject(new Error(message))
        await flush()
        expect((prompted.error as Error).message).toBe(message)
        expect(reports).toContain(message)
        expect(inbox.get(id)).toBeDefined()
        expect(settled.done).toBe(false)

        // A later prompt opens a fresh dialog and a person's answer settles the entry
        const retried = track(inbox.prompt(id))
        await flush()
        expect(fake.asks).toHaveLength(2)
        fake.asks[1]?.resolve({ status: 'answered', value: 'Ada' })
        await flush()
        const accept = { action: 'accept', content: { name: 'Ada' } }
        expect(retried.result).toEqual(accept)
        expect(settled.result).toEqual(accept)
      },
    )

    test.each([
      ['a comma', 'a,b'],
      ['a leading dash', '-timeout'],
    ])(
      'forced alerter refusing a label with %s: canPrompt is false and the entry stays pending',
      async (_, label) => {
        inbox.registerAnswerSurface()
        const h = create({
          platform: 'darwin',
          env: { PATH: binDir },
          backends: { ask: 'alerter' },
        })
        const settled = track(h(request(ChoiceForm(label))))
        await flush()
        expect(inbox.get(onlyEntryId())?.canPrompt).toBe(false)
        await expectPendingAfterRejectedPrompt(settled)
        expect(fake.asks).toHaveLength(0)
      },
    )

    test.each([
      ['dismissed', { action: 'cancel' }],
      ['declined', { action: 'decline' }],
    ] as const)("a person's %s dialog still settles the entry", async (status, expected) => {
      inbox.registerAnswerSurface()
      const h = create()
      const settled = track(h(request()))
      await flush()
      const id = onlyEntryId()
      const prompted = track(inbox.prompt(id))
      await flush()
      fake.asks[0]?.resolve({ status })
      await flush()
      expect(prompted.result).toEqual(expected)
      expect(settled.result).toEqual(expected)
      expect(inbox.get(id)).toBeUndefined()
    })
  })

  describe('task input contract', () => {
    test('withdrawal removes the inbox entry with withdrawn', async () => {
      inbox.registerAnswerSurface()
      const removed = vi.fn()
      inbox.events.on('removed', removed)
      const controller = new AbortController()
      const h = create()
      const settled = track(h(request(undefined, controller.signal)))
      await flush()
      const id = onlyEntryId()
      const reason = new TaskInputWithdrawnError({ taskID: 't1', key: 'k1' })
      controller.abort(reason)
      await flush()
      expect(removed).toHaveBeenCalledWith({ id, reason: 'withdrawn' })
      expect(inbox.list()).toEqual([])
      expect(settled.error).toBe(reason)
    })

    test('in blocking mode, withdrawal kills the open dialog', async () => {
      const controller = new AbortController()
      const h = create({ mode: 'dialog', inbox: undefined })
      const settled = track(h(request(undefined, controller.signal)))
      await flush()
      expect(fake.asks).toHaveLength(1)
      const reason = new TaskInputWithdrawnError({ taskID: 't1', key: 'k1' })
      controller.abort(reason)
      await flush()
      expect(fake.asks[0]?.options.signal.aborted).toBe(true)
      expect(settled.error).toBe(reason)
    })
  })
})
