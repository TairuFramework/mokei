import type { MonitorPresenceReceive } from '@mokei/host-protocol'
import { afterEach, expect, test, vi } from 'vitest'

import {
  createMonitorPresence,
  PRESENCE_REPLY_TIMEOUT_MS,
  parseMonitorURL,
} from '../src/monitor-presence.js'

const signal = () => new AbortController().signal
afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  let id = 0
  const presence = createMonitorPresence({ randomID: () => `id-${++id}`, now: () => Date.now() })
  const attachment = presence.attach('http://127.0.0.1:4000/')
  const messages: Array<MonitorPresenceReceive> = []
  const close = vi.fn()
  const tab = presence.connect(attachment.attachmentID, {
    send: (message) => messages.push(message),
    close,
  })
  const key = presence.tabs()[0]?.key
  if (key == null) throw new Error('Expected tab')
  return { presence, attachment, messages, close, tab, key }
}

test('accepts the exact loopback monitor URL', () => {
  expect(parseMonitorURL('http://127.0.0.1:4000/').href).toBe('http://127.0.0.1:4000/')
  expect(parseMonitorURL('http://127.0.0.1:80/').port).toBe('')
})
test.each([
  'https://127.0.0.1:4000/',
  'http://localhost:4000/',
  'http://127.0.0.1:4000/x',
  'http://u:p@127.0.0.1:4000/',
  'http://127.0.0.1:4000/?q',
  'http://127.0.0.1:4000/#f',
  'http://127.0.0.1:0/',
  'http://127.0.0.1:65536/',
  'http://127.0.0.1/',
  'http://127.0.0.1:4000/x/../',
  'http://127.1:4000/',
  'http://127.0.0.1:4000/\n',
])('rejects invalid monitor URL %s', (url) => {
  expect(() => parseMonitorURL(url)).toThrow(expect.objectContaining({ name: 'MonitorURLError' }))
})

test('tracks live attachment order and closes only detached tabs', () => {
  const { presence, attachment, close } = setup()
  const second = presence.attach('http://127.0.0.1:5000/')
  const secondClose = vi.fn()
  presence.connect(second.attachmentID, { send: () => {}, close: secondClose })
  expect(presence.currentURL()?.port).toBe('5000')
  second.detach()
  second.detach()
  expect(secondClose).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  expect(presence.currentURL()?.port).toBe('4000')
  attachment.detach()
  expect(close).toHaveBeenCalledTimes(1)
  expect(presence.currentURL()).toBeUndefined()
  expect(() => presence.connect(second.attachmentID, { send: () => {}, close: () => {} })).toThrow(
    expect.objectContaining({ name: 'MonitorAttachmentNotFoundError' }),
  )
})

test('tracks status, active item and every visible state timestamp', () => {
  const { presence, tab } = setup()
  expect(presence.tabs()[0]?.lastVisibleAt).toBe(0)
  expect(presence.status()).toBe('unavailable')
  tab.receive({ type: 'state', visible: false, canNotify: true })
  expect(presence.status()).toBe('reachable')
  vi.setSystemTime(100)
  tab.receive({ type: 'state', visible: true, canNotify: false, activeItemID: 'item' })
  expect(presence.status()).toBe('attended')
  expect(presence.tabs()[0]).toMatchObject({ lastVisibleAt: 100, activeItemID: 'item' })
  vi.setSystemTime(200)
  tab.receive({ type: 'state', visible: true, canNotify: false })
  expect(presence.tabs()[0]?.lastVisibleAt).toBe(200)
  expect(presence.tabs()[0]?.activeItemID).toBeUndefined()
})

test('pings visible tabs concurrently and returns on first pong', async () => {
  const { presence, tab, messages, attachment } = setup()
  tab.receive({ type: 'state', visible: true, canNotify: false })
  const otherMessages: Array<MonitorPresenceReceive> = []
  presence
    .connect(attachment.attachmentID, {
      send: (message) => otherMessages.push(message),
      close: () => {},
    })
    .receive({ type: 'state', visible: true, canNotify: false })
  const attended = presence.isAttended(signal())
  expect(messages[0]?.type).toBe('ping')
  expect(otherMessages[0]?.type).toBe('ping')
  const ping = messages[0]
  if (ping?.type !== 'ping') throw new Error('Expected ping')
  tab.receive({ type: 'pong', nonce: 'unknown' })
  tab.receive({ type: 'pong', nonce: ping.nonce })
  expect(await attended).toBe(true)
  await vi.advanceTimersByTimeAsync(PRESENCE_REPLY_TIMEOUT_MS)
  expect(presence.tabs()[1]?.visible).toBe(false)
})

test('demotes frozen tabs until another state and ignores late pongs', async () => {
  const { presence, tab, messages } = setup()
  tab.receive({ type: 'state', visible: true, canNotify: true })
  const attended = presence.isAttended(signal())
  const ping = messages[0]
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await attended).toBe(false)
  expect(presence.status()).toBe('reachable')
  if (ping?.type !== 'ping') throw new Error('Expected ping')
  tab.receive({ type: 'pong', nonce: ping.nonce })
  expect(presence.tabs()[0]?.visible).toBe(false)
  tab.receive({ type: 'state', visible: true, canNotify: true })
  expect(presence.status()).toBe('attended')
})

test.each([true, false])('request resolves ack shown=%s', async (shown) => {
  const { presence, tab, key, messages } = setup()
  const message = {
    type: 'prompt',
    attemptID: 'attempt',
    deadline: Date.now() + 5_000,
    itemID: 'item',
  } as const
  const request = presence.request(key, message, signal())
  expect(messages).toEqual([message])
  tab.receive({ type: 'ack', attemptID: 'attempt', shown })
  expect(await request).toBe(shown)
  expect(vi.getTimerCount()).toBe(0)
})

test('request times out, ignores late ack and supports withdraw', async () => {
  const { presence, tab, key, messages } = setup()
  const request = presence.request(
    key,
    {
      type: 'notify',
      attemptID: 'attempt',
      deadline: Date.now() + 5_000,
      itemID: 'item',
      title: 'Title',
      message: 'Message',
    },
    signal(),
  )
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await request).toBe(false)
  tab.receive({ type: 'ack', attemptID: 'attempt', shown: true })
  presence.withdraw(key, 'attempt')
  expect(messages.at(-1)).toEqual({ type: 'withdraw', attemptID: 'attempt' })
})

test('abort and disconnect settle pending replies and clean timers and listeners', async () => {
  const { presence, tab, key, close } = setup()
  const controller = new AbortController()
  const ping = presence.ping(key, controller.signal)
  controller.abort()
  expect(await ping).toBe(false)
  const listener = vi.fn()
  const removed = vi.fn()
  presence.onTabClosed(key, listener)
  presence.onTabClosed(key, removed)()
  const request = presence.request(
    key,
    { type: 'prompt', attemptID: 'attempt', deadline: 5_000, itemID: 'item' },
    signal(),
  )
  tab.disconnect()
  tab.disconnect()
  expect(await request).toBe(false)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(removed).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(await presence.ping(key, signal())).toBe(false)
  expect(await presence.isAttended(signal())).toBe(false)
})

test('dispose closes all tabs and resolves outstanding replies', async () => {
  const { presence, key, close } = setup()
  const ping = presence.ping(key, signal())
  presence.dispose()
  presence.dispose()
  expect(await ping).toBe(false)
  expect(close).toHaveBeenCalledTimes(1)
  expect(presence.tabs()).toEqual([])
  expect(presence.currentURL()).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})
