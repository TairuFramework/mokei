import type { InboxItem } from '@mokei/flow-host'
import type { MonitorPresenceReceive } from '@mokei/host-protocol'
import { afterEach, expect, test, vi } from 'vitest'

import { createMonitorPresence } from '../src/monitor-presence.js'
import { createMonitorSurface } from '../src/monitor-surface.js'

const item: InboxItem = {
  id: 'run:approval',
  runID: 'run',
  kind: 'approval',
  plan: { tools: [] },
  createdAt: 1,
}
const input: InboxItem = {
  id: 'run:input',
  runID: 'run',
  kind: 'input',
  inputKey: 'input',
  message: 'Private input',
  requestedSchema: { type: 'object', properties: {} },
  createdAt: 1,
}
const options = () => ({ signal: new AbortController().signal })
afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(100)
  let id = 0
  const presence = createMonitorPresence({ randomID: () => `presence-${++id}` })
  const attachment = presence.attach('http://127.0.0.1:4000/')
  const surface = createMonitorSurface(presence, { randomID: () => 'attempt', now: () => 200 })
  function connect(visible: boolean, canNotify: boolean, timestamp = 100) {
    const messages: Array<MonitorPresenceReceive> = []
    const tab = presence.connect(attachment.attachmentID, {
      send: (message) => messages.push(message),
      close: () => {},
    })
    vi.setSystemTime(timestamp)
    tab.receive({ type: 'state', visible, canNotify })
    return { tab, messages }
  }
  return { presence, surface, connect }
}
function pong(target: ReturnType<ReturnType<typeof setup>['connect']>) {
  const message = target.messages.at(-1)
  if (message?.type !== 'ping') throw new Error('Expected ping')
  target.tab.receive({ type: 'pong', nonce: message.nonce })
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

test('two frozen visible tabs exhaust prompt attention in one timeout', async () => {
  const { surface, connect } = setup()
  const first = connect(true, false)
  const second = connect(true, false)
  const finished = vi.fn()
  const operation = surface.prompt?.(item, options()).then(finished)
  expect(first.messages[0]?.type).toBe('ping')
  expect(second.messages[0]?.type).toBe('ping')
  await vi.advanceTimersByTimeAsync(4_999)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(finished).toHaveBeenCalledWith(null)
  await operation
  expect(vi.getTimerCount()).toBe(0)
})

test('prompt uses the first visible pong without waiting for a frozen tab', async () => {
  const { surface, connect } = setup()
  const frozen = connect(true, false)
  const target = connect(true, false)
  const operation = surface.prompt?.(item, options())
  pong(target)
  await flush()
  expect(target.messages.at(-1)?.type).toBe('prompt')
  target.tab.receive({ type: 'ack', attemptID: 'attempt', shown: true })
  const delivery = await operation
  expect(delivery).not.toBeNull()
  delivery?.close()
  expect(frozen.messages.map((message) => message.type)).toEqual(['ping'])
  expect(vi.getTimerCount()).toBe(0)
})

test.each([
  [item, 'Flow needs your approval'],
  [input, 'Flow needs your input'],
] as const)(
  'notifies the most recently visible eligible tab with generic wording: %j',
  async (pending, message) => {
    const { surface, connect } = setup()
    const older = connect(true, true, 100)
    const newer = connect(true, true, 150)
    newer.tab.receive({ type: 'state', visible: false, canNotify: true })
    const ineligible = connect(true, false, 190)
    const operation = surface.notify(pending, options())
    expect(older.messages).toEqual([])
    expect(ineligible.messages).toEqual([])
    pong(newer)
    await flush()
    expect(newer.messages.at(-1)).toEqual({
      type: 'notify',
      attemptID: 'attempt',
      deadline: 5200,
      itemID: pending.id,
      title: 'mokei',
      message,
    })
    newer.tab.receive({ type: 'ack', attemptID: 'attempt', shown: true })
    const delivery = await operation
    expect(delivery).not.toBeNull()
    delivery?.close()
    delivery?.close()
    expect(newer.messages.filter((m) => m.type === 'withdraw')).toEqual([
      { type: 'withdraw', attemptID: 'attempt' },
    ])
    await delivery?.closed
    expect(vi.getTimerCount()).toBe(0)
  },
)
test('notify with no eligible tab sends nothing', async () => {
  const { surface, connect } = setup()
  const target = connect(true, false)
  expect(await surface.notify(item, options())).toBeNull()
  expect(target.messages).toEqual([])
})
test('ping timeout withdraws and never notifies or tries another tab', async () => {
  const { surface, connect } = setup()
  const older = connect(true, true, 50)
  const target = connect(true, true)
  const operation = surface.notify(item, options())
  await vi.advanceTimersByTimeAsync(5000)
  expect(await operation).toBeNull()
  expect(target.messages.map((m) => m.type)).toEqual(['ping', 'withdraw'])
  expect(older.messages).toEqual([])
})
test.each(['notify', 'prompt'] as const)('%s ack failure withdraws the attempt', async (method) => {
  const { surface, connect } = setup()
  const target = connect(true, true)
  const operation = surface[method]?.(item, options())
  pong(target)
  await flush()
  target.tab.receive({ type: 'ack', attemptID: 'attempt', shown: false })
  expect(await operation).toBeNull()
  expect(target.messages.at(-1)).toEqual({ type: 'withdraw', attemptID: 'attempt' })
})
test('prompt prefers a visible tab and closes on target disconnect', async () => {
  const { surface, connect } = setup()
  const target = connect(true, false, 100)
  const hidden = connect(true, true, 150)
  hidden.tab.receive({ type: 'state', visible: false, canNotify: true })
  const operation = surface.prompt?.(item, options())
  expect(hidden.messages).toEqual([])
  pong(target)
  await flush()
  expect(target.messages.at(-1)).toEqual({
    type: 'prompt',
    attemptID: 'attempt',
    deadline: 5200,
    itemID: item.id,
  })
  target.tab.receive({ type: 'ack', attemptID: 'attempt', shown: true })
  const delivery = await operation
  expect(delivery).not.toBeNull()
  const closed = vi.fn()
  void delivery?.closed.then(closed)
  await flush()
  expect(closed).not.toHaveBeenCalled()
  target.tab.disconnect()
  await delivery?.closed
  expect(closed).toHaveBeenCalledTimes(1)
  delivery?.close()
})
test('prompt falls back to the most recently visible notification tab after visible ping failure', async () => {
  const { surface, connect } = setup()
  const frozen = connect(true, false)
  const older = connect(true, true, 120)
  older.tab.receive({ type: 'state', visible: false, canNotify: true })
  const target = connect(true, true, 150)
  target.tab.receive({ type: 'state', visible: false, canNotify: true })
  const operation = surface.prompt?.(item, options())
  await vi.advanceTimersByTimeAsync(5000)
  expect(frozen.messages[0]?.type).toBe('ping')
  expect(older.messages).toEqual([])
  pong(target)
  await flush()
  target.tab.receive({ type: 'ack', attemptID: 'attempt', shown: true })
  const delivery = await operation
  expect(delivery).not.toBeNull()
  delivery?.close()
  await delivery?.closed
  expect(target.messages.at(-1)).toEqual({ type: 'withdraw', attemptID: 'attempt' })
})
test('prompt with no eligible tab sends nothing', async () => {
  const { surface, connect } = setup()
  const target = connect(false, false)
  expect(await surface.prompt?.(item, options())).toBeNull()
  expect(target.messages).toEqual([])
})
test.each(['notify', 'prompt'] as const)('%s ack timeout withdraws', async (method) => {
  const { surface, connect } = setup()
  const target = connect(true, true)
  const operation = surface[method]?.(item, options())
  pong(target)
  await flush()
  await vi.advanceTimersByTimeAsync(5000)
  expect(await operation).toBeNull()
  expect(target.messages.at(-1)).toEqual({ type: 'withdraw', attemptID: 'attempt' })
})
test.each(['notify', 'prompt'] as const)(
  '%s handles abort before and during ping/request',
  async (method) => {
    for (const phase of ['before', 'ping', 'request']) {
      const { surface, connect } = setup()
      const target = connect(true, true)
      const controller = new AbortController()
      if (phase === 'before') controller.abort()
      const operation = surface[method]?.(item, { signal: controller.signal })
      if (phase === 'request') {
        pong(target)
        await flush()
      }
      controller.abort()
      expect(await operation).toBeNull()
      expect(target.messages.map((m) => m.type)).toEqual(
        phase === 'before' ? [] : phase === 'ping' ? ['ping'] : ['ping', method, 'withdraw'],
      )
      expect(vi.getTimerCount()).toBe(0)
    }
  },
)
test('notification closes on target disconnect and delegates status and attention', async () => {
  const { surface, presence, connect } = setup()
  const target = connect(true, true)
  expect(surface.name).toBe('monitor')
  expect(surface.status()).toBe(presence.status())
  const attended = surface.isAttended(options().signal)
  pong(target)
  expect(await attended).toBe(true)
  const operation = surface.notify(item, options())
  pong(target)
  await flush()
  target.tab.receive({ type: 'ack', attemptID: 'attempt', shown: true })
  const delivery = await operation
  expect(delivery).not.toBeNull()
  target.tab.disconnect()
  await delivery?.closed
  expect(surface.status()).toBe('unavailable')
})
