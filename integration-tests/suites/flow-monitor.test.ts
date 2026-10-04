import { startMonitor } from '@mokei/host-monitor'
import { afterEach, expect, test } from 'vitest'

import { connectTab } from '../support/connect-tab.js'
import { startFlowMonitorDaemon } from '../support/flow-monitor-daemon.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const failures: Array<unknown> = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed')
})

async function setup() {
  const daemon = await startFlowMonitorDaemon()
  cleanups.push(() => daemon.dispose())
  const monitor = await startMonitor({ socketPath: daemon.socketPath })
  cleanups.push(() => monitor.disposer.dispose())
  const { client } = daemon
  const tab = async (options: Parameters<typeof connectTab>[1]) => {
    const connected = await connectTab(monitor, options)
    cleanups.push(() => connected.close())
    return connected
  }
  const pending = async (caller = client) => {
    const run = await caller.request('runs.start', { param: { flow: 'input' }, timeout: 10_000 })
    await expect
      .poll(
        async () =>
          (await caller.request('inbox.list', { param: { runID: run.runID }, timeout: 1000 }))
            .length,
      )
      .toBe(1)
    const [item] = await caller.request('inbox.list', { param: { runID: run.runID } })
    if (item == null) throw new Error('Expected pending item')
    return item
  }
  return { ...daemon, monitor, tab, pending }
}

test('a visible tab suppresses native notifications', async () => {
  const fixture = await setup()
  const tab = await fixture.tab({ visible: true, canNotify: true })
  await fixture.pending()
  await expect
    .poll(() => tab.completedReplies.filter((reply) => reply.type === 'pong').length)
    .toBe(1)
  await tab.barrier()
  expect(fixture.notify).not.toHaveBeenCalled()
  expect(tab.messages.filter((message) => message.type === 'notify')).toEqual([])
})

test('a hidden notification-capable tab receives the notification', async () => {
  const fixture = await setup()
  const tab = await fixture.tab({ visible: false, canNotify: true })
  const item = await fixture.pending()
  await expect
    .poll(() => tab.messages)
    .toContainEqual(expect.objectContaining({ type: 'notify', itemID: item.id }))
  const notification = tab.messages.find(
    (message) => message.type === 'notify' && message.itemID === item.id,
  )
  if (notification?.type !== 'notify') throw new Error('Expected tab notification')
  await expect
    .poll(() => tab.completedReplies)
    .toContainEqual({
      type: 'ack',
      attemptID: notification.attemptID,
      shown: true,
    })
  await tab.barrier()
  expect(fixture.notify).not.toHaveBeenCalled()
  expect(tab.failures).toEqual([])
})

test('a frozen tab falls back to the native notifier', async () => {
  const fixture = await setup()
  const tab = await fixture.tab({ visible: true, canNotify: true, pong: false })
  await fixture.pending()
  await expect.poll(() => fixture.notify.mock.calls.length, { timeout: 12_000 }).toBe(1)
  await tab.barrier()
  expect(tab.completedReplies).toEqual([])
}, 30_000)

test('a socket prompt routes to the tab and accepts its HTTP answer', async () => {
  const fixture = await setup()
  const tab = await fixture.tab({ visible: true, canNotify: true })
  const item = await fixture.pending()
  const prompted = fixture.client.request('inbox.prompt', {
    param: { id: item.id },
    timeout: 10_000,
  })
  void prompted.catch(() => {})
  await expect
    .poll(() => tab.messages)
    .toContainEqual(expect.objectContaining({ type: 'prompt', itemID: item.id }))
  expect(
    await tab.client.request('inbox.answer', { id: item.id, content: { value: 'Ada' } }),
  ).toEqual({ settled: true })
  expect(await prompted).toEqual({ action: 'accept' })
  expect(fixture.prompt).not.toHaveBeenCalled()
})

test('closing the tab session falls back to a native dialog', async () => {
  const fixture = await setup()
  const tab = await fixture.tab({ visible: true, canNotify: true })
  const item = await fixture.pending()
  const prompted = fixture.client.request('inbox.prompt', {
    param: { id: item.id },
    timeout: 10_000,
  })
  void prompted.catch(() => {})
  await expect
    .poll(() => tab.messages)
    .toContainEqual(expect.objectContaining({ type: 'prompt', itemID: item.id }))
  await tab.close()
  await expect.poll(() => fixture.prompt.mock.calls.length).toBe(1)
  await fixture.client.request('inbox.answer', {
    param: { id: item.id, content: { value: 'remote' } },
  })
  expect(await prompted).toEqual({ action: 'accept' })
})

test('native notification click opens the monitor item URL', async () => {
  const fixture = await setup()
  const item = await fixture.pending()
  await expect.poll(() => fixture.notify.mock.calls.length).toBe(1)
  fixture.notify.mock.calls[0]?.[1]?.onClick?.()
  await expect
    .poll(() => fixture.openURL.mock.calls)
    .toEqual([[`${fixture.monitor.url}inbox/${encodeURIComponent(item.id)}`]])
  expect(fixture.prompt).not.toHaveBeenCalled()
})

test('daemon restart re-attaches the monitor and the same open tab recovers', async () => {
  const fixture = await setup()
  const tab = await fixture.tab({ visible: false, canNotify: true })
  const tabClient = tab.client
  const { url, token, port } = fixture.monitor
  const client = await fixture.restart()
  await expect.poll(() => tab.connections, { timeout: 15_000 }).toBe(2)
  expect(tab.client).toBe(tabClient)
  expect(fixture.monitor).toMatchObject({ url, token, port })
  const nativeCalls = fixture.notify.mock.calls.length
  const item = await fixture.pending(client)
  await expect
    .poll(() => tab.messages)
    .toContainEqual(expect.objectContaining({ type: 'notify', itemID: item.id }))
  const notification = tab.messages.find(
    (message) => message.type === 'notify' && message.itemID === item.id,
  )
  if (notification?.type !== 'notify') throw new Error('Expected recovered tab notification')
  await expect
    .poll(() => tab.completedReplies)
    .toContainEqual({
      type: 'ack',
      attemptID: notification.attemptID,
      shown: true,
    })
  await tab.barrier()
  expect(fixture.notify.mock.calls.length).toBe(nativeCalls)
  expect(tab.failures).toEqual([])
  expect(
    await tabClient.request('inbox.answer', { id: item.id, content: { value: 'reconnected' } }),
  ).toEqual({ settled: true })
  await tab.close()
  const nativeItem = await fixture.pending(client)
  await expect.poll(() => fixture.notify.mock.calls.length).toBe(nativeCalls + 1)
  fixture.notify.mock.calls[nativeCalls]?.[1]?.onClick()
  // Opening this URL proves the new presence instance has its currentURL again.
  await expect
    .poll(() => fixture.openURL.mock.calls)
    .toEqual([[`${url}inbox/${encodeURIComponent(nativeItem.id)}`]])
})
