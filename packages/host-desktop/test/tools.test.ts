import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElicitResult } from '@mokei/context-protocol'
import { ContextHost } from '@mokei/host'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'

import {
  type BackendName,
  createDesktopTools,
  type DesktopBackend,
  type DesktopElicitRequest,
  type DesktopToolsOptions,
  type NotifyRequest,
  type Runner,
} from '../src/index.js'

const binDir = mkdtempSync(join(tmpdir(), 'mokei-host-desktop-tools-'))
for (const name of ['osascript', 'notify-send']) {
  const path = join(binDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true })
})

const LINUX_ENV = { PATH: binDir, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }

type NotifyCall = { name: BackendName; request: NotifyRequest; signal: AbortSignal }

function setup(options: Partial<DesktopToolsOptions> = {}, notify?: DesktopBackend['notify']) {
  const notifications: Array<NotifyCall> = []
  const host = new ContextHost()
  host.addLocalTools(
    createDesktopTools({
      platform: 'linux',
      env: LINUX_ENV,
      createBackend: (name) => ({
        name,
        notify:
          notify ??
          (async (request, { signal }) => {
            notifications.push({ name, request, signal })
          }),
      }),
      ...options,
    }),
  )
  return { host, notifications }
}

function answerSchema(request: DesktopElicitRequest | undefined): unknown {
  const params = request?.params as
    | { requestedSchema?: { properties: Record<string, unknown> } }
    | undefined
  return params?.requestedSchema?.properties.answer
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent
}

afterEach(() => {
  vi.useRealTimers()
})

describe('registration', () => {
  test('returns notify and ask_user when elicit is given', () => {
    const tools = createDesktopTools({ elicit: async () => ({ action: 'cancel' }) })
    expect(tools.map((t) => t.name)).toEqual(['notify', 'ask_user'])
  })

  test('notify: false omits notify', () => {
    const tools = createDesktopTools({
      notify: false,
      elicit: async () => ({ action: 'cancel' }),
    })
    expect(tools.map((t) => t.name)).toEqual(['ask_user'])
  })

  test('no elicit omits ask_user', () => {
    expect(createDesktopTools({}).map((t) => t.name)).toEqual(['notify'])
  })

  test.each([Number.NaN, 0, -5, Number.POSITIVE_INFINITY])(
    'an invalid timeoutSeconds (%s) throws',
    (value) => {
      expect(() => createDesktopTools({ timeoutSeconds: value })).toThrow(
        new TypeError(`timeoutSeconds must be a finite number greater than 0, got ${value}`),
      )
    },
  )

  test('ask_user description mentions timeouts', () => {
    const tool = createDesktopTools({ elicit: async () => ({ action: 'cancel' }) }).find(
      (t) => t.name === 'ask_user',
    )
    expect(tool?.description).toContain('A timeout returns status "cancelled".')
  })
})

describe('dispose', () => {
  test('disposes the runner it creates', async () => {
    const runners: Array<Runner> = []
    const tools = createDesktopTools({
      platform: 'linux',
      env: LINUX_ENV,
      createBackend: (name, runner) => {
        runners.push(runner)
        return { name, notify: async () => {} }
      },
    })
    const host = new ContextHost()
    host.addLocalTools(tools)
    await host.callLocalTool({ name: 'notify', arguments: { message: 'm' } })
    expect(runners).toHaveLength(1)
    await tools.dispose()
    await expect(
      runners[0]?.run(process.execPath, ['-e', ''], { timeoutMs: 1000 }),
    ).rejects.toThrow('Runner disposed')
  })

  test('does not dispose a runner it was given', async () => {
    const runner = { run: vi.fn(), dispose: vi.fn(async () => {}) }
    const tools = createDesktopTools({ runner })
    await tools.dispose()
    expect(runner.dispose).not.toHaveBeenCalled()
  })

  test('dispose removes live notifications without disposing an injected runner', async () => {
    const runner = { run: vi.fn(), dispose: vi.fn(async () => {}) }
    let exit!: () => void
    let lifetime: AbortSignal | undefined
    const tools = createDesktopTools({
      platform: 'linux',
      env: LINUX_ENV,
      runner,
      createBackend: (name) => ({
        name,
        notify: async (_request, options) => {
          lifetime = options.lifetime
          const closed = new Promise<void>((resolve) => {
            exit = resolve
          })
          return { closed }
        },
      }),
    })
    const host = new ContextHost()
    host.addLocalTools(tools)
    await host.callLocalTool({ name: 'notify', arguments: { message: 'm' } })
    expect(lifetime?.aborted).toBe(false)
    const done = vi.fn()
    const disposing = tools.dispose().then(done)
    expect(lifetime?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(done).not.toHaveBeenCalled()
    exit()
    await disposing
    expect(runner.dispose).not.toHaveBeenCalled()
  })

  test('notify after dispose reports an error and starts no runner', async () => {
    const created: Array<Runner> = []
    const tools = createDesktopTools({
      platform: 'linux',
      env: LINUX_ENV,
      createBackend: (name, runner) => {
        created.push(runner)
        return { name, notify: async () => {} }
      },
    })
    await tools.dispose()
    const host = new ContextHost()
    host.addLocalTools(tools)
    const result = await host.callLocalTool({ name: 'notify', arguments: { message: 'm' } })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Desktop tools disposed' }])
    expect(created).toHaveLength(0)
  })
})

describe('notify', () => {
  test('delivers and returns the backend', async () => {
    const { host, notifications } = setup({ appName: 'App' })
    const result = await host.callLocalTool({
      name: 'notify',
      arguments: { message: 'Done', subtitle: 'sub', sound: true },
    })
    expect(result.isError).toBeUndefined()
    expect(structured(result)).toEqual({ delivered: true, backend: 'notify-send' })
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ delivered: true, backend: 'notify-send' }) },
    ])
    expect(notifications[0]?.request).toEqual({
      title: 'App',
      message: 'Done',
      subtitle: 'sub',
      sound: true,
    })
  })

  test('uses the given title', async () => {
    const { host, notifications } = setup()
    await host.callLocalTool({ name: 'notify', arguments: { message: 'm', title: 'T' } })
    expect(notifications[0]?.request.title).toBe('T')
  })

  test.each(['', '   '])('an empty title (%j) falls back to the app name', async (title) => {
    const { host, notifications } = setup({ appName: 'App' })
    await host.callLocalTool({ name: 'notify', arguments: { message: 'm', title } })
    expect(notifications[0]?.request.title).toBe('App')
  })

  test('rejects a missing message naming the field', async () => {
    const { host } = setup()
    const result = await host.callLocalTool({ name: 'notify', arguments: {} })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('message')
  })

  test('reports a missing backend with the hint', async () => {
    const { host } = setup({ env: { PATH: binDir } })
    const result = await host.callLocalTool({ name: 'notify', arguments: { message: 'm' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('notify-send')
  })

  test('reports a backend failure', async () => {
    const { host } = setup({}, async () => {
      throw new Error('boom')
    })
    const result = await host.callLocalTool({ name: 'notify', arguments: { message: 'm' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('boom')
  })

  test('times out delivery after 5 seconds', async () => {
    vi.useFakeTimers()
    const { host } = setup({}, () => new Promise<void>(() => {}))
    const pending = host.callLocalTool({ name: 'notify', arguments: { message: 'm' } })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('timed out')
  })
})

describe('ask_user', () => {
  function withElicit(
    respond: (request: DesktopElicitRequest) => Promise<ElicitResult> | ElicitResult,
    options: Partial<DesktopToolsOptions> = {},
  ) {
    const requests: Array<DesktopElicitRequest> = []
    const { host } = setup({
      elicit: async (request) => {
        requests.push(request)
        return respond(request)
      },
      ...options,
    })
    return { host, requests }
  }

  async function ask(host: ContextHost, args: Record<string, unknown>, signal?: AbortSignal) {
    return await host.callLocalTool({ name: 'ask_user', arguments: args, signal })
  }

  describe('validation', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['missing question', { kind: 'text' }, 'question'],
      ['bad kind', { question: 'q', kind: 'x' }, 'kind'],
      ['choice without choices', { question: 'q', kind: 'choice' }, 'choices'],
      ['one choice', { question: 'q', kind: 'choice', choices: ['a'] }, 'choices'],
      [
        'too many choices',
        { question: 'q', kind: 'choice', choices: Array.from({ length: 21 }, (_, i) => `c${i}`) },
        'choices',
      ],
      ['duplicate choices', { question: 'q', kind: 'choice', choices: ['a', 'a'] }, 'choices'],
      ['empty choice', { question: 'q', kind: 'choice', choices: ['a', ''] }, 'choices'],
      [
        'default not in choices',
        { question: 'q', kind: 'choice', choices: ['a', 'b'], default: 'c' },
        'default',
      ],
      ['confirm default invalid', { question: 'q', kind: 'confirm', default: 'maybe' }, 'default'],
      ['choices on text', { question: 'q', kind: 'text', choices: ['a', 'b'] }, 'choices'],
    ]
    test.each(cases)('%s', async (_name, args, field) => {
      const { host, requests } = withElicit(() => ({ action: 'cancel' }))
      const result = await ask(host, args)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain(field)
      expect(requests).toHaveLength(0)
    })
  })

  describe('request shape', () => {
    test('text', async () => {
      const { host, requests } = withElicit(() => ({ action: 'cancel' }))
      await ask(host, { question: 'Name?', kind: 'text', default: 'Bob' })
      expect(requests[0]?.key).toBe('local')
      expect(requests[0]?.params).toEqual({
        mode: 'form',
        message: 'Name?',
        requestedSchema: {
          type: 'object',
          properties: { answer: { type: 'string', default: 'Bob' } },
          required: ['answer'],
        },
      })
      expect(requests[0]?.signal).toBeInstanceOf(AbortSignal)
    })

    test('confirm maps yes/no to a boolean default', async () => {
      const { host, requests } = withElicit(() => ({ action: 'cancel' }))
      await ask(host, { question: 'Ok?', kind: 'confirm', default: 'yes' })
      await ask(host, { question: 'Ok?', kind: 'confirm', default: 'no' })
      await ask(host, { question: 'Ok?', kind: 'confirm' })
      expect(requests.map(answerSchema)).toEqual([
        { type: 'boolean', default: true },
        { type: 'boolean', default: false },
        { type: 'boolean' },
      ])
    })

    test('choice', async () => {
      const { host, requests } = withElicit(() => ({ action: 'cancel' }))
      await ask(host, { question: 'Pick', kind: 'choice', choices: ['a', 'b'], default: 'b' })
      expect(answerSchema(requests[0])).toEqual({
        type: 'string',
        enum: ['a', 'b'],
        default: 'b',
      })
    })
  })

  describe('results', () => {
    test('answered', async () => {
      const { host } = withElicit(() => ({ action: 'accept', content: { answer: 'Bob' } }))
      const result = await ask(host, { question: 'q', kind: 'text' })
      expect(result.isError).toBeUndefined()
      expect(structured(result)).toEqual({ status: 'answered', value: 'Bob' })
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify({ status: 'answered', value: 'Bob' }) },
      ])
    })

    test('answered boolean', async () => {
      const { host } = withElicit(() => ({ action: 'accept', content: { answer: false } }))
      const result = await ask(host, { question: 'q', kind: 'confirm' })
      expect(structured(result)).toEqual({ status: 'answered', value: false })
    })

    test('declined', async () => {
      const { host } = withElicit(() => ({ action: 'decline' }))
      const result = await ask(host, { question: 'q', kind: 'text' })
      expect(structured(result)).toEqual({ status: 'declined' })
      expect(result.isError).toBeUndefined()
    })

    test('cancelled', async () => {
      const { host } = withElicit(() => ({ action: 'cancel' }))
      const result = await ask(host, { question: 'q', kind: 'text' })
      expect(structured(result)).toEqual({ status: 'cancelled' })
    })
  })

  test('its own timeout gives cancelled', async () => {
    vi.useFakeTimers()
    const { host } = withElicit(() => new Promise<ElicitResult>(() => {}), {
      timeoutSeconds: 30,
    })
    const pending = ask(host, { question: 'q', kind: 'text' })
    await vi.advanceTimersByTimeAsync(29_999)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.isError).toBeUndefined()
    expect(structured(result)).toEqual({ status: 'cancelled' })
  })

  test('an external cancel gives isError', async () => {
    const { host } = withElicit(() => new Promise<ElicitResult>(() => {}))
    const controller = new AbortController()
    const pending = ask(host, { question: 'q', kind: 'text' }, controller.signal)
    controller.abort(new Error('stop'))
    const result = await pending
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('stop')
  })

  test('other rejections rethrow as isError', async () => {
    const { host } = withElicit(() => Promise.reject(new Error('handler broke')))
    const result = await ask(host, { question: 'q', kind: 'text' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('handler broke')
  })
})
