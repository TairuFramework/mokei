import type { FlowEvent } from '@mokei/flow-client'
import type { MonitorPresenceReceive } from '@mokei/host-protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { FlowContext, type FlowContextValue } from '../src/flow/FlowProvider.js'
import { PresenceProvider, usePresence } from '../src/presence/PresenceProvider.js'

const { navigate, show, hide } = vi.hoisted(() => ({
  navigate: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@mantine/notifications', () => ({ notifications: { show, hide } }))
let permission: NotificationPermission
let visible: DocumentVisibilityState
let permissionStatus: EventTarget
let notices: Array<{ close: ReturnType<typeof vi.fn>; onclick: (() => void) | null }>
beforeEach(() => {
  vi.useFakeTimers()
  permission = 'granted'
  visible = 'visible'
  notices = []
  permissionStatus = new EventTarget()
  navigate.mockResolvedValue(undefined)
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return permission
      }
      static requestPermission = vi.fn(async () => {
        permission = 'granted'
        return permission
      })
      close = vi.fn()
      onclick = null
      title: string
      options: NotificationOptions
      constructor(title: string, options: NotificationOptions) {
        this.title = title
        this.options = options
        notices.push(this)
      }
    },
  )
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible)
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => permissionStatus) },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function fixture() {
  const channels: Array<{
    controller: ReadableStreamDefaultController<MonitorPresenceReceive>
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }> = []
  const listeners = new Set<(event: FlowEvent) => void>()
  const list = vi.fn(async () => [{ id: 'item' }])
  const createChannel = vi.fn(() => {
    let controller!: ReadableStreamDefaultController<MonitorPresenceReceive>
    const readable = new ReadableStream<MonitorPresenceReceive>({
      start(c) {
        controller = c
      },
    })
    const channel = Object.assign(Promise.resolve(), {
      readable,
      send: vi.fn(async () => {}),
      close: vi.fn(),
    })
    channels.push({ controller, ...channel })
    return channel
  })
  const flow = {
    client: { createChannel },
    control: { inbox: { list } },
    epoch: 0,
    connected: true,
    restarted: false,
    on(listener: (event: FlowEvent) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  } as unknown as FlowContextValue
  function Controls() {
    const p = usePresence()
    return (
      <>
        <button type="button" onClick={() => p.setActiveItem('other')}>
          active
        </button>
        <button type="button" onClick={() => p.requestPermission()}>
          permission
        </button>
        <span>{String(p.canNotify)}</span>
      </>
    )
  }
  const tree = () => (
    <FlowContext value={{ ...flow }}>
      <PresenceProvider>
        <Controls />
      </PresenceProvider>
    </FlowContext>
  )
  const view = render(tree())
  const receive = async (message: MonitorPresenceReceive) => {
    await act(async () => {
      channels.at(-1)?.controller.enqueue(message)
    })
  }
  return { channels, createChannel, flow, listeners, list, view, tree, receive }
}
const notify = (extra = {}) => ({
  type: 'notify' as const,
  attemptID: 'attempt',
  itemID: 'item',
  deadline: Date.now() + 5000,
  title: 'Title',
  message: 'Message',
  ...extra,
})
const prompt = () => ({
  type: 'prompt' as const,
  attemptID: 'attempt',
  itemID: 'item',
  deadline: Date.now() + 5000,
})
test('sends first state and visibility, active item and permission changes', async () => {
  const f = fixture()
  expect(f.createChannel).toHaveBeenCalledWith('monitor.presence', { param: { attachmentID: '' } })
  expect(f.channels[0].send).toHaveBeenNthCalledWith(1, {
    type: 'state',
    visible: true,
    canNotify: true,
  })
  visible = 'hidden'
  fireEvent(document, new Event('visibilitychange'))
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'state',
    visible: false,
    canNotify: true,
  })
  fireEvent.click(screen.getByText('active'))
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'state',
    visible: false,
    canNotify: true,
    activeItemID: 'other',
  })
  await act(async () => {})
  permission = 'denied'
  act(() => permissionStatus.dispatchEvent(new Event('change')))
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'state',
    visible: false,
    canNotify: false,
    activeItemID: 'other',
  })
})
test('answers ping', async () => {
  const f = fixture()
  await f.receive({ type: 'ping', nonce: 'nonce' })
  expect(f.channels[0].send).toHaveBeenLastCalledWith({ type: 'pong', nonce: 'nonce' })
})
test('hidden notify displays, acknowledges and links a tagged notification', async () => {
  visible = 'hidden'
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
  const f = fixture()
  await f.receive(notify())
  expect(notices[0]).toMatchObject({ title: 'Title', options: { body: 'Message', tag: 'item' } })
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'ack',
    attemptID: 'attempt',
    shown: true,
  })
  notices[0].onclick?.()
  expect(focus).toHaveBeenCalled()
  expect(navigate).toHaveBeenCalledWith({ href: '/inbox/item' })
})
test('notify without permission acknowledges false', async () => {
  visible = 'hidden'
  permission = 'denied'
  const f = fixture()
  await f.receive(notify())
  expect(notices).toHaveLength(0)
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'ack',
    attemptID: 'attempt',
    shown: false,
  })
})
test('expired deliveries are dropped without acknowledgement', async () => {
  const f = fixture()
  await f.receive(notify({ deadline: Date.now() - 1 }))
  await f.receive({ ...prompt(), deadline: Date.now() - 1 })
  expect(f.channels[0].send.mock.calls.every(([message]) => message.type === 'state')).toBe(true)
  expect(navigate).not.toHaveBeenCalled()
  expect(show).not.toHaveBeenCalled()
})
test('prompt navigates and acknowledges', async () => {
  const f = fixture()
  await f.receive(prompt())
  expect(navigate).toHaveBeenCalledWith({ href: '/inbox/item' })
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'ack',
    attemptID: 'attempt',
    shown: true,
  })
})
test('another form gets toast and hidden notification; withdraw closes both', async () => {
  visible = 'hidden'
  const f = fixture()
  fireEvent.click(screen.getByText('active'))
  await f.receive(prompt())
  expect(show).toHaveBeenCalled()
  expect(notices).toHaveLength(1)
  expect(navigate).not.toHaveBeenCalled()
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'ack',
    attemptID: 'attempt',
    shown: true,
  })
  await f.receive({ type: 'withdraw', attemptID: 'attempt' })
  expect(notices[0].close).toHaveBeenCalled()
  expect(hide).toHaveBeenCalledWith('attempt')
})
test('visible inbox additions toast and settlement closes notifications', async () => {
  const f = fixture()
  act(() => {
    for (const listener of f.listeners)
      listener({ type: 'inbox:added', data: { id: 'item', message: 'New item' } } as FlowEvent)
  })
  expect(show).toHaveBeenCalled()
  visible = 'hidden'
  await f.receive(notify())
  act(() => {
    for (const listener of f.listeners)
      listener({
        type: 'inbox:settled',
        data: { item: { id: 'item' }, outcome: 'answered' },
      } as FlowEvent)
  })
  expect(notices[0].close).toHaveBeenCalled()
})
test('channel end reopens with backoff, resends state and reconciles notifications', async () => {
  visible = 'hidden'
  const f = fixture()
  await f.receive(notify())
  f.list.mockResolvedValue([])
  await act(async () => {
    f.channels[0].controller.close()
  })
  expect(f.createChannel).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(f.createChannel).toHaveBeenCalledTimes(2)
  expect(f.channels[1].send).toHaveBeenNthCalledWith(1, {
    type: 'state',
    visible: false,
    canNotify: true,
  })
  expect(notices[0].close).toHaveBeenCalled()
})
test('epoch replaces channel and unmount closes acknowledged prompt channel', async () => {
  const f = fixture()
  await f.receive(prompt())
  f.flow.epoch++
  f.view.rerender(f.tree())
  expect(f.channels[0].close).toHaveBeenCalled()
  expect(f.channels).toHaveLength(2)
  f.view.unmount()
  expect(f.channels[1].close).toHaveBeenCalled()
})
test('pagehide closes channel and stops retry', async () => {
  const f = fixture()
  await f.receive(prompt())
  fireEvent(window, new Event('pagehide'))
  expect(f.channels[0].close).toHaveBeenCalled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(f.createChannel).toHaveBeenCalledTimes(1)
})
test('permission request updates context and state from a user gesture', async () => {
  permission = 'default'
  const f = fixture()
  expect(screen.getByText('false')).toBeTruthy()
  await act(async () => {
    fireEvent.click(screen.getByText('permission'))
  })
  expect(Notification.requestPermission).toHaveBeenCalledOnce()
  expect(screen.getByText('true')).toBeTruthy()
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'state',
    visible: true,
    canNotify: true,
  })
})
test('repeated channel failures increase backoff and unmount cancels pending retry', async () => {
  const f = fixture()
  await act(async () => {
    f.channels[0].controller.error(new Error('daemon stopped'))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  await act(async () => {
    f.channels[1].controller.error(new Error('still offline'))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999)
  })
  expect(f.createChannel).toHaveBeenCalledTimes(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(f.createChannel).toHaveBeenCalledTimes(3)
  await act(async () => {
    f.channels[2].controller.close()
  })
  f.view.unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(f.createChannel).toHaveBeenCalledTimes(3)
})
test('constructor failure acknowledges notify false', async () => {
  visible = 'hidden'
  vi.stubGlobal(
    'Notification',
    class {
      static permission = 'granted'
      constructor() {
        throw new Error('unsupported')
      }
    },
  )
  const f = fixture()
  await f.receive(notify())
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'ack',
    attemptID: 'attempt',
    shown: false,
  })
})
test('hidden prompt without notification permission declines delivery', async () => {
  visible = 'hidden'
  permission = 'denied'
  const f = fixture()
  await f.receive(prompt())
  expect(f.channels[0].send).toHaveBeenLastCalledWith({
    type: 'ack',
    attemptID: 'attempt',
    shown: false,
  })
})
