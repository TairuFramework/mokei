import { connectSocket, createTransportStream } from '@enkaku/socket'
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
  createTransportStream: vi.fn(),
}))

let monitor: Monitor | undefined
let messages: Array<unknown>
let replies: ReadableStreamDefaultController<unknown>
let attachments: Array<{ header: unknown; payload: { rid: string; prm: { url: string } } }>
const browserMessages = () =>
  messages.filter(
    (message) => (message as { payload: { prc?: string } }).payload.prc !== 'monitor.attach',
  )

beforeEach(() => {
  messages = []
  attachments = []
  vi.mocked(createTransportStream).mockReset()
  vi.mocked(connectSocket).mockClear()
  daemon.readable = new ReadableStream({
    start(controller) {
      replies = controller
    },
  })
  daemon.writable = new WritableStream({
    write(message) {
      messages.push(message)
      const msg = message as (typeof attachments)[number] & { payload: { prc?: string } }
      if (msg.payload.prc === 'monitor.attach') {
        attachments.push(msg)
        replies.enqueue({
          header: {},
          payload: {
            typ: 'receive',
            rid: msg.payload.rid,
            val: { type: 'attached', attachmentID: `attachment-${attachments.length}` },
          },
        })
      }
    },
  })
  vi.mocked(createTransportStream).mockImplementation(async () => {
    if (daemon.readable == null || daemon.writable == null) throw new Error('Missing fake socket')
    return { readable: daemon.readable, writable: daemon.writable }
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
    await expect.poll(() => browserMessages().length).toBe(1)
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
        header: { typ: 'JWT', alg: 'none' },
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
      expect(browserMessages()).toEqual([])
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
            prm: { attachmentID: 'attachment-1' },
          },
        })
    } finally {
      controller.abort()
    }
  })
})

describe('monitor daemon lifecycle (in memory)', () => {
  beforeEach(() => {
    local.inMemory = true
  })

  test('attaches with its listening URL and closes the attachment on disposal', async () => {
    monitor = await startMonitor()
    await expect.poll(() => attachments.length).toBe(1)
    expect(attachments[0]?.header).toEqual({ typ: 'JWT', alg: 'none' })
    expect(attachments[0]?.payload).toMatchObject({
      typ: 'stream',
      prc: 'monitor.attach',
      prm: { url: monitor.url },
    })
    await monitor.disposer.dispose()
    expect(daemon.writable?.locked).toBe(false)
    expect(daemon.readable?.locked).toBe(false)
  })

  test('daemon EOF ends open SSE bodies and re-attaches with a fresh bridge', async () => {
    monitor = await startMonitor()
    const response = await post({ typ: 'stream', prc: 'events', rid: 'events' })
    if (response.body == null) throw new Error('Expected SSE body')
    const reader = response.body.getReader()
    // Drain the bridge's initial SSE comment before waiting for EOF.
    await reader.read()
    const ended = reader.read()
    const secondResponse = await post({ typ: 'stream', prc: 'events', rid: 'second-events' })
    if (secondResponse.body == null) throw new Error('Expected second SSE body')
    const secondReader = secondResponse.body.getReader()
    await secondReader.read()
    const secondEnded = secondReader.read()
    const oldReplies = replies
    daemon.readable = new ReadableStream({
      start(controller) {
        replies = controller
      },
    })
    daemon.writable = new WritableStream({
      write(message) {
        messages.push(message)
        const msg = message as (typeof attachments)[number] & { payload: { prc?: string } }
        if (msg.payload.prc === 'monitor.attach') {
          attachments.push(msg)
          replies.enqueue({
            header: {},
            payload: {
              typ: 'receive',
              rid: msg.payload.rid,
              val: { type: 'attached', attachmentID: 'attachment-2' },
            },
          })
        }
      },
    })
    oldReplies.close()
    expect(await ended).toMatchObject({ done: true })
    expect(await secondEnded).toMatchObject({ done: true })
    await expect.poll(() => attachments.length).toBe(2)
    expect(attachments[1]?.payload.prm).toEqual({ url: monitor.url })
    const presence = await post({
      typ: 'channel',
      prc: 'monitor.presence',
      rid: 'new-tab',
      prm: { attachmentID: 'forged' },
    })
    expect(presence.status).toBe(200)
    await expect
      .poll(() => messages)
      .toContainEqual({
        header: {},
        payload: {
          typ: 'channel',
          prc: 'monitor.presence',
          rid: 'new-tab',
          prm: { attachmentID: 'attachment-2' },
        },
      })
    await presence.body?.cancel()
  })

  test('retries failed connections with bounded backoff and stops on disposal', async () => {
    vi.useFakeTimers()
    try {
      monitor = await startMonitor()
      vi.mocked(createTransportStream).mockRejectedValue(new Error('Daemon unavailable'))
      replies.close()
      await vi.advanceTimersByTimeAsync(0)
      const baseline = vi.mocked(createTransportStream).mock.calls.length
      for (const delay of [250, 500, 1000, 2000, 4000, 5000, 5000]) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        const count = vi.mocked(createTransportStream).mock.calls.length
        await vi.advanceTimersByTimeAsync(1)
        expect(vi.mocked(createTransportStream).mock.calls.length).toBe(count + 1)
      }
      expect(vi.mocked(createTransportStream).mock.calls.length).toBe(baseline + 7)
      await monitor.disposer.dispose()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(vi.mocked(createTransportStream).mock.calls.length).toBe(baseline + 7)
    } finally {
      vi.useRealTimers()
    }
  })
})

test('in memory disposal stops a reconnect awaiting attachment', async () => {
  local.inMemory = true
  monitor = await startMonitor()
  const oldReplies = replies
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
  oldReplies.close()
  await expect.poll(() => vi.mocked(createTransportStream).mock.calls.length).toBe(2)
  await monitor.disposer.dispose()
  expect(daemon.writable.locked).toBe(false)
  expect(daemon.readable.locked).toBe(false)
  expect(vi.mocked(createTransportStream).mock.calls).toHaveLength(2)
})
