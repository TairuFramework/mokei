import type * as LocalServer from '@tejika/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { type Monitor, startMonitor } from '../src/index.js'

const local = vi.hoisted(() => ({
  inMemory: false,
  handler: undefined as ((ctx: { req: { raw: Request } }) => Promise<Response>) | undefined,
}))
vi.mock('@tejika/server', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalServer>()
  return {
    ...actual,
    createLocalServer: (params: Parameters<typeof actual.createLocalServer>[0]) =>
      local.inMemory
        ? Promise.resolve({
            app: {
              all: (_path: string, handler: typeof local.handler) => {
                local.handler = handler
              },
            },
            url: 'http://127.0.0.1:19347',
            token: 'browser-token',
            close: async () => {},
          })
        : actual.createLocalServer(params),
    serveStaticSPA: vi.fn(),
  }
})

const daemon = vi.hoisted(() => ({
  readable: undefined as ReadableStream<unknown> | undefined,
  writable: undefined as WritableStream<unknown> | undefined,
}))
vi.mock('@enkaku/socket', () => ({
  connectSocket: vi.fn(),
  createTransportStream: () => daemon,
}))

let monitor: Monitor | undefined
let messages: Array<unknown>
let replies: ReadableStreamDefaultController<unknown>

beforeEach(() => {
  messages = []
  daemon.readable = new ReadableStream({
    start(controller) {
      replies = controller
    },
  })
  daemon.writable = new WritableStream({
    write(message) {
      messages.push(message)
    },
  })
})
afterEach(async () => {
  await monitor?.disposer.dispose()
  monitor = undefined
})

async function post(payload: unknown, signal?: AbortSignal) {
  if (monitor == null) throw new Error('Monitor not started')
  const request = new Request(
    new URL('api', monitor.url.endsWith('/') ? monitor.url : `${monitor.url}/`),
    {
      method: 'POST',
      headers: {
        Origin: new URL(monitor.url).origin,
        Authorization: `Bearer ${monitor.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ header: {}, payload }),
      signal,
    },
  )
  if (!local.inMemory) return await fetch(request)
  if (local.handler == null) throw new Error('HTTP handler not installed')
  return await local.handler({ req: { raw: request } })
}

describe.each(['in memory', 'localhost'])('monitor browser transport (%s)', (mode) => {
  beforeEach(() => {
    local.inMemory = mode === 'in memory'
  })
  test('returns a URL with a trailing slash', async () => {
    monitor = await startMonitor({ port: 19347 })
    expect(monitor.url).toBe('http://127.0.0.1:19347/')
  })

  test('accepts authenticated browser POSTs with the monitor origin', async () => {
    monitor = await startMonitor({ port: 19347 })
    const pending = post({ typ: 'request', prc: 'context.list', rid: 'request', prm: {} })
    await expect.poll(() => messages.length).toBe(1)
    replies.enqueue({ header: {}, payload: { typ: 'result', rid: 'request', val: [] } })
    expect((await pending).status).toBe(200)
  })

  test('forwards SSE disconnection aborts to the daemon', async () => {
    monitor = await startMonitor({ port: 19347 })
    const controller = new AbortController()
    const response = await post(
      { typ: 'stream', prc: 'context.watch', rid: 'watch', prm: {} },
      controller.signal,
    )
    expect(response.status).toBe(200)
    controller.abort()
    await expect
      .poll(() => messages)
      .toContainEqual({
        header: {},
        payload: { typ: 'abort', rid: 'watch', rsn: 'ClientDisconnected' },
      })
  })

  test('rejects browser attachment without forwarding it', async () => {
    monitor = await startMonitor({ port: 19347 })
    const controller = new AbortController()
    try {
      const response = await post(
        { typ: 'stream', prc: 'monitor.attach', rid: 'attach', prm: { url: monitor.url } },
        controller.signal,
      )
      expect(response.status).toBe(200)
      if (response.body == null) throw new Error('Expected an SSE response body')
      const reader = response.body.getReader()
      let text = ''
      while (!text.includes('FORBIDDEN')) {
        const chunk = await reader.read()
        if (chunk.done) break
        text += new TextDecoder().decode(chunk.value)
      }
      expect(text).toContain('"rid":"attach"')
      expect(text).toContain('"code":"FORBIDDEN"')
      expect(messages).toEqual([])
    } finally {
      controller.abort()
    }
  })

  test('stamps presence opens with the current attachment ID', async () => {
    monitor = await startMonitor({ port: 19347 })
    const controller = new AbortController()
    try {
      const response = await post(
        {
          typ: 'channel',
          prc: 'monitor.presence',
          rid: 'presence',
          prm: { attachmentID: 'browser-forgery' },
        },
        controller.signal,
      )
      expect(response.status).toBe(200)
      await expect
        .poll(() => messages)
        .toContainEqual({
          header: {},
          payload: {
            typ: 'channel',
            prc: 'monitor.presence',
            rid: 'presence',
            prm: { attachmentID: '' },
          },
        })
    } finally {
      controller.abort()
    }
  })
})
