import type { Monitor } from '@mokei/host-monitor'
import { afterEach, expect, test, vi } from 'vitest'

import { connectTab } from '../support/connect-tab.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.unstubAllGlobals()
})

function transport() {
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = []
  const sends: Array<Record<string, unknown>> = []
  let unavailable = false
  let replyGate: Promise<void> = Promise.resolve()
  let barrierGate: Promise<void> = Promise.resolve()
  vi.stubGlobal('fetch', async (_url: URL, init: RequestInit) => {
    const { payload } = JSON.parse(String(init.body))
    if (payload.typ === 'channel') {
      if (unavailable) return new Response('Daemon reconnecting', { status: 503 })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller)
          init.signal?.addEventListener('abort', () => {
            try {
              controller.close()
            } catch {
              // A previous connection may already have ended.
            }
          })
        },
      })
      return new Response(stream, { headers: { 'enkaku-session-id': `session-${streams.length}` } })
    }
    if (payload.typ === 'send') {
      sends.push(payload.val)
      if (payload.val.type !== 'state') await replyGate
      return new Response(null, { status: 204 })
    }
    await barrierGate
    return Response.json({ payload: { typ: 'result', val: {} } })
  })
  return {
    streams,
    sends,
    emit(value: unknown) {
      streams
        .at(-1)
        ?.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ payload: { typ: 'receive', val: value } })}\n\n`,
          ),
        )
    },
    setUnavailable(value: boolean) {
      unavailable = value
    },
    delayReplies(reply: Promise<void>, barrier: Promise<void>) {
      replyGate = reply
      barrierGate = barrier
    },
  }
}

const monitor = { url: 'http://127.0.0.1:12345/', token: 'test-token' } as Monitor

test('completed replies wait for the HTTP write and the following monitor barrier', async () => {
  const http = transport()
  const tab = await connectTab(monitor, { visible: true, canNotify: true })
  cleanups.push(() => tab.close())
  const written = Promise.withResolvers<void>()
  const processed = Promise.withResolvers<void>()
  cleanups.unshift(async () => {
    written.resolve()
    processed.resolve()
  })
  http.delayReplies(written.promise, processed.promise)
  http.emit({ type: 'ping', nonce: 'fresh-ping' })
  await expect.poll(() => http.sends).toContainEqual({ type: 'pong', nonce: 'fresh-ping' })
  expect(tab.completedReplies).toEqual([])
  written.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(tab.completedReplies).toEqual([])
  processed.resolve()
  await expect.poll(() => tab.completedReplies).toEqual([{ type: 'pong', nonce: 'fresh-ping' }])
  http.emit({ type: 'notify', attemptID: 'delivery', itemID: 'item' })
  await expect
    .poll(() => tab.completedReplies)
    .toContainEqual({ type: 'ack', attemptID: 'delivery', shown: true })
})

test('the same tab retries an ended channel and stops reconnecting when closed', async () => {
  const http = transport()
  const tab = await connectTab(monitor, { visible: false, canNotify: true })
  cleanups.push(() => tab.close())
  const client = tab.client
  http.setUnavailable(true)
  http.streams[0]?.close()
  await new Promise<void>((resolve) => setTimeout(resolve, 300))
  expect(tab.connections).toBe(1)
  http.setUnavailable(false)
  await expect.poll(() => tab.connections, { timeout: 2000 }).toBe(2)
  expect(tab.client).toBe(client)
  expect(http.sends.filter((value) => value.type === 'state')).toEqual([
    { type: 'state', visible: false, canNotify: true },
    { type: 'state', visible: false, canNotify: true },
  ])
  http.emit({ type: 'ping', nonce: 'after-restart' })
  await expect
    .poll(() => tab.completedReplies)
    .toContainEqual({ type: 'pong', nonce: 'after-restart' })
  http.streams.at(-1)?.close()
  await tab.close()
  await new Promise<void>((resolve) => setTimeout(resolve, 300))
  expect(tab.connections).toBe(2)
  expect(tab.failures).toEqual([])
})
