import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'

import type {
  AskResult,
  BackendCallOptions,
  DesktopBackend,
  DesktopElicitOptions,
  DesktopElicitRequest,
  DesktopInputSurface,
  NotifyRequest,
} from '../src/index.js'
import { createDesktopInputSurface } from '../src/index.js'

const binDir = mkdtempSync(join(tmpdir(), 'mokei-input-surface-'))
for (const name of ['zenity', 'notify-send']) {
  const path = join(binDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}
afterAll(() => rmSync(binDir, { recursive: true, force: true }))

function request(): DesktopElicitRequest {
  return {
    key: 'ctx',
    params: {
      message: 'Please answer',
      requestedSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    signal: new AbortController().signal,
  }
}
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

describe('desktop input surface', () => {
  let surface: DesktopInputSurface
  let calls: Array<{
    options: BackendCallOptions
    resolve: (result: AskResult) => void
    reject: (reason: unknown) => void
  }>
  let notifications: Array<NotifyRequest>
  function create(options: DesktopElicitOptions = {}): DesktopInputSurface {
    surface = createDesktopInputSurface({
      platform: 'linux',
      env: { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' },
      createBackend: (name): DesktopBackend => ({
        name,
        ask: (_request, options) =>
          new Promise((resolve, reject) => {
            calls.push({ options, resolve, reject })
          }),
        notify: async (notification) => {
          notifications.push(notification)
        },
      }),
      ...options,
    })
    return surface
  }
  beforeEach(() => {
    calls = []
    notifications = []
  })
  afterEach(async () => {
    await surface?.dispose()
  })

  test('canPrompt is false for URL mode and unsupported forms, true for a string field', () => {
    const s = create()
    expect(s.canPrompt(request())).toBe(true)
    expect(
      s.canPrompt({
        ...request(),
        params: {
          mode: 'url',
          message: 'Sign in',
          url: 'https://example.com',
          elicitationId: 'login',
        },
      }),
    ).toBe(false)
    expect(
      s.canPrompt({
        ...request(),
        params: {
          message: 'Please answer',
          requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } },
        },
      } as unknown as DesktopElicitRequest),
    ).toBe(false)
    expect(calls).toHaveLength(0)
  })
  test('prompt resolves accept with content', async () => {
    const answer = create().prompt(request())
    await flush()
    calls[0]?.resolve({ status: 'answered', value: 'Ada' })
    await expect(answer).resolves.toEqual({ action: 'accept', content: { name: 'Ada' } })
  })
  test.each([
    ['declined', 'decline'],
    ['dismissed', 'cancel'],
  ] as const)('prompt resolves %s from the user', async (status, action) => {
    const answer = create().prompt(request())
    await flush()
    calls[0]?.resolve({ status })
    await expect(answer).resolves.toEqual({ action })
  })
  test('prompt rejects when the backend fails', async () => {
    const failure = new Error('Backend failed')
    const answer = create().prompt(request())
    const rejected = expect(answer).rejects.toBe(failure)
    await flush()
    calls[0]?.reject(failure)
    await rejected
  })
  test.each(['request', 'options'] as const)(
    'prompt aborts its dialogs when the %s signal aborts',
    async (from) => {
      const controller = new AbortController()
      const input = request()
      if (from === 'request') input.signal = controller.signal
      const answer = create().prompt(
        input,
        from === 'options' ? { signal: controller.signal } : undefined,
      )
      const reason = new Error('Input withdrawn')
      const rejected = expect(answer).rejects.toBe(reason)
      await flush()
      controller.abort(reason)
      await rejected
      expect(calls[0]?.options.signal.aborted).toBe(true)
      calls[0]?.resolve({ status: 'dismissed' })
    },
  )
  test.each<[DesktopElicitOptions, string]>([
    [{}, 'ctx needs your input'],
    [{ describeSource: () => 'Flow' }, 'Flow needs your input'],
    [{ appName: 'Rig', notificationPromptPreview: true }, 'ctx needs your input: Please answer'],
  ])(
    'notify sends one notification with the inbox notification text (%j)',
    async (options, message) => {
      await create(options).notify(request())
      expect(notifications).toEqual([{ title: options.appName ?? 'mokei', message }])
    },
  )
  test('notify falls back to the default source without a context key', async () => {
    await create().notify({ ...request(), key: undefined })
    expect(notifications).toEqual([{ title: 'mokei', message: 'A server needs your input' }])
  })
  test('mode and inbox are ignored', async () => {
    const answer = create({ mode: 'inbox' }).prompt(request())
    await flush()
    calls[0]?.resolve({ status: 'answered', value: 'Ada' })
    await expect(answer).resolves.toEqual({ action: 'accept', content: { name: 'Ada' } })
  })
  test('dispose aborts open dialogs and rejects later prompts', async () => {
    const s = create()
    const answer = s.prompt(request())
    const rejected = expect(answer).rejects.toThrow('disposed')
    await flush()
    const disposing = s.dispose()
    expect(s.dispose()).toBe(disposing)
    await disposing
    await rejected
    expect(calls[0]?.options.signal.aborted).toBe(true)
    calls[0]?.resolve({ status: 'dismissed' })
    await expect(s.prompt(request())).rejects.toThrow('disposed')
  })
})
