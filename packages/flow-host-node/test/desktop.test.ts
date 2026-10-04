import type { ElicitResult } from '@mokei/context-protocol'
import type { FlowHost, InboxItem, InboxOutcome } from '@mokei/flow-host'
import { createFlowHost, InboxAnswerInvalidError } from '@mokei/flow-host'
import { Session } from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import type { FlowDesktopAdapter, FlowDesktopController } from '../src/desktop.js'
import { createFlowDesktopController } from '../src/desktop.js'
import { createMonitorPresence } from '../src/monitor-presence.js'
import { createMonitorSurface } from '../src/monitor-surface.js'
import { createNativeSurface } from '../src/native-surface.js'
import type { InboxSurface } from '../src/surfaces.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const first: InboxItem = {
  id: 'one:approval',
  runID: 'one',
  kind: 'approval',
  plan: { tools: ['local:echo'] },
  createdAt: 1,
}
const second: InboxItem = {
  id: 'two:input',
  runID: 'two',
  kind: 'input',
  inputKey: 'input',
  message: 'Secret',
  requestedSchema: { type: 'object', properties: {} },
  createdAt: 2,
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()))
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function setup(
  options: {
    notifications?: boolean
    host?: FlowHost
    adapter?: Partial<FlowDesktopAdapter>
    surfaces?: Array<InboxSurface>
  } = {},
) {
  const adapter: FlowDesktopAdapter = {
    canPrompt: () => true,
    prompt: vi.fn<FlowDesktopAdapter['prompt']>(async () => ({
      action: 'accept',
      content: { approve: true },
    })),
    notify: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    ...options.adapter,
  }
  const errors: Array<unknown> = []
  const native = createNativeSurface({
    adapter,
    notifications: options.notifications ?? true,
    host: () => {
      return options.host ?? ({ inbox: { get: () => second } } as unknown as FlowHost)
    },
    monitorURL: () => undefined,
    onError: (error) => errors.push(error),
  })
  const controller = createFlowDesktopController({
    surfaces: [...(options.surfaces ?? []), native],
    native,
    host: () => {
      return options.host ?? ({ inbox: { get: () => second } } as unknown as FlowHost)
    },
    onError: (error) => errors.push(error),
  })
  cleanup.push(() => controller.dispose())
  return { controller, adapter, errors }
}
test.each([
  [[], []],
  [[first], ['Flow needs your approval']],
  [[second], ['Flow needs your input']],
  [[first, second], ['2 pending prompts']],
] satisfies Array<[Array<InboxItem>, Array<string>]>)(
  'restored population %j sends its generic notification',
  async (items, messages) => {
    const { controller, adapter } = setup()
    controller.added(first)
    controller.added(second)
    expect(adapter.notify).not.toHaveBeenCalled()
    controller.restored(items)
    await controller.dispose()
    expect(vi.mocked(adapter.notify).mock.calls.map(([message]) => message)).toEqual(messages)
  },
)
test('startup bookkeeping survives settlement and delayed delivery without duplicate notifications', async () => {
  const gate = deferred<void>()
  const { controller, adapter } = setup({ adapter: { notify: vi.fn(() => gate.promise) } })
  controller.restored([first, second])
  controller.settled(first, 'withdrawn')
  controller.added(first)
  controller.added(second)
  controller.added({ ...second, id: 'three:input' })
  controller.added({ ...second, id: 'three:input' })
  await vi.waitFor(() => expect(adapter.notify).toHaveBeenCalledTimes(2))
  gate.resolve()
  await controller.dispose()
  expect(vi.mocked(adapter.notify).mock.calls.map(([message]) => message)).toEqual([
    '2 pending prompts',
    'Flow needs your input',
  ])
})
test('disabled notifications never call the backend', async () => {
  const { controller, adapter } = setup({ notifications: false })
  controller.restored([first, second])
  controller.added({ ...first, id: 'new:approval' })
  await controller.dispose()
  expect(adapter.notify).not.toHaveBeenCalled()
})
test('notification errors report once without retry', async () => {
  const failure = new Error('Notification failed')
  const { controller, adapter, errors } = setup({
    adapter: {
      notify: vi.fn(async () => {
        throw failure
      }),
    },
  })
  controller.restored([first])
  controller.added(first)
  await controller.dispose()
  expect(adapter.notify).toHaveBeenCalledTimes(1)
  expect(errors).toEqual([failure])
})
function notifyOptions(adapter: FlowDesktopAdapter, index = 0) {
  const options = vi.mocked(adapter.notify).mock.calls[index]?.[1]
  if (options == null) throw new Error('Expected notification options')
  return options
}
test('each item notification has its own group and the summary a fixed one', async () => {
  const { controller, adapter } = setup()
  controller.restored([first, second])
  controller.added({ ...second, id: 'three:input' })
  controller.added({ ...first, id: 'four:approval' })
  await vi.waitFor(() => expect(adapter.notify).toHaveBeenCalledTimes(3))
  expect(notifyOptions(adapter, 0).group).toBe('mokei-inbox-pending')
  expect(notifyOptions(adapter, 1).group).toBe('mokei-inbox-three:input')
  expect(notifyOptions(adapter, 2).group).toBe('mokei-inbox-four:approval')
  expect(notifyOptions(adapter, 1).onClick).toEqual(expect.any(Function))
})
test('settlement removes the item notification', async () => {
  const { controller, adapter } = setup()
  controller.restored([])
  controller.added(second)
  await vi.waitFor(() => expect(adapter.notify).toHaveBeenCalledTimes(1))
  const options = notifyOptions(adapter)
  expect(options.signal?.aborted).toBe(false)
  controller.settled(second, 'answered')
  expect(options.signal?.aborted).toBe(true)
})
const inputFlow: FlowDefinition = {
  id: 'input',
  name: 'Input',
  version: 1,
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Choose' },
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done' },
  },
}
async function runtime(approval = false) {
  const session = new Session({
    elicit: async () => {
      throw new Error('Unexpected elicitation')
    },
  })
  session.contextHost.addLocalTool({
    name: 'echo',
    inputSchema: { type: 'object' },
    execute: () => ({ content: [] }),
  })
  let controller: FlowDesktopController | undefined
  const host = await createFlowHost({
    session,
    predictor: {
      predict: async () => {
        throw new Error('Unexpected prediction')
      },
    },
    pollMs: 10,
    listeners: { 'inbox:settled': ({ item, outcome }) => controller?.settled(item, outcome) },
  })
  cleanup.push(async () => {
    await host.dispose()
    await session.dispose()
  })
  const run = await host.start({
    definition: approval
      ? {
          id: 'echo',
          name: 'Echo',
          version: 1,
          start: 'echo',
          nodes: {
            echo: { kind: 'tool', tool: 'local:echo', args: {}, next: 'done' },
            done: { kind: 'end', outcome: 'done' },
          },
        }
      : inputFlow,
    label: 'My flow',
  })
  await vi.waitFor(() => expect(host.inbox.list()).toHaveLength(1))
  const item = host.inbox.list()[0]
  if (item == null) throw new Error('Expected item')
  return {
    host,
    run,
    item,
    connect: (value: FlowDesktopController) => {
      controller = value
    },
  }
}
test.each([
  [{ action: 'accept', content: { approve: true } }, 'accept', 'completed'],
  [{ action: 'accept', content: { approve: false } }, 'decline', 'denied'],
  [{ action: 'decline' }, 'decline', 'denied'],
  [{ action: 'cancel' }, 'cancel', 'cancelled'],
] satisfies Array<[ElicitResult, string, string]>)(
  'approval %j settles explicitly',
  async (result, action, state) => {
    const { host, run, item, connect } = await runtime(true)
    const { controller, adapter } = setup({
      host,
      notifications: false,
      adapter: { prompt: vi.fn(async () => result) },
    })
    connect(controller)
    await expect(controller.prompt(item.id, new AbortController().signal)).resolves.toEqual({
      action,
    })
    await vi.waitFor(async () => expect((await host.get(run.runID))?.state).toBe(state))
    expect(vi.mocked(adapter.prompt).mock.calls[0]?.[0].params).toMatchObject({
      message: expect.stringContaining('My flow'),
      requestedSchema: { required: ['approve'] },
    })
    expect(vi.mocked(adapter.prompt).mock.calls[0]?.[0].params.message).toContain('local:echo')
  },
)
test.each<ElicitResult['content']>([undefined, {}, { approve: 'true' }])(
  'malformed approval %j leaves its item pending',
  async (content) => {
    const { host, item } = await runtime(true)
    const { controller } = setup({
      host,
      adapter: { prompt: async () => ({ action: 'accept', content }) },
    })
    await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toThrow(
      'approval',
    )
    expect(host.inbox.get(item.id)).toEqual(item)
  },
)
test('input content goes through runtime validation', async () => {
  const { host, item, connect } = await runtime()
  const prompt = vi
    .fn<FlowDesktopAdapter['prompt']>()
    .mockResolvedValueOnce({ action: 'accept', content: {} })
    .mockResolvedValueOnce({ action: 'accept', content: { value: 'Ada' } })
  const { controller } = setup({ host, adapter: { prompt } })
  connect(controller)
  await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toBeInstanceOf(
    InboxAnswerInvalidError,
  )
  expect(host.inbox.get(item.id)).toEqual(item)
  await expect(controller.prompt(item.id, new AbortController().signal)).resolves.toEqual({
    action: 'accept',
  })
  expect(host.inbox.list()).toEqual([])
})
test('unsupported forms and backend failures leave the item pending', async () => {
  const { host, item } = await runtime()
  const { controller, adapter } = setup({ host, adapter: { canPrompt: () => false } })
  await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toMatchObject({
    name: 'DesktopPromptUnavailableError',
  })
  expect(adapter.prompt).not.toHaveBeenCalled()
  adapter.canPrompt = () => true
  adapter.prompt = async () => {
    throw new Error('Backend failed')
  }
  await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toThrow(
    'Backend failed',
  )
  expect(host.inbox.get(item.id)).toEqual(item)
})
test('duplicate ownership is rejected before a delayed run lookup completes', async () => {
  const { host, item, connect } = await runtime()
  const gate = deferred<Awaited<ReturnType<FlowHost['get']>>>()
  const lookup = vi.spyOn(host, 'get').mockReturnValueOnce(gate.promise)
  const { controller } = setup({ host, adapter: { prompt: async () => ({ action: 'cancel' }) } })
  connect(controller)
  const firstPrompt = controller.prompt(item.id, new AbortController().signal)
  await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toMatchObject({
    name: 'InboxPromptInProgressError',
  })
  lookup.mockRestore()
  gate.resolve(await host.get(item.runID))
  await firstPrompt
})
test.each(['caller', 'settlement', 'shutdown'] as const)(
  '%s abort prevents late answers and releases ownership',
  async (source) => {
    const { host, item, connect } = await runtime()
    const gate = deferred<ElicitResult>()
    const prompt = vi
      .fn<FlowDesktopAdapter['prompt']>()
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValueOnce({ action: 'accept', content: { value: 'Ada' } })
    const { controller, adapter } = setup({ host, adapter: { prompt } })
    connect(controller)
    const caller = new AbortController()
    const answer = controller.prompt(item.id, caller.signal)
    const outcome = answer.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    let disposing: Promise<void> | undefined
    let disposed = false
    if (source === 'caller') caller.abort(new Error('Disconnected'))
    else if (source === 'settlement') await host.inbox.decline(item.id)
    else {
      disposing = controller.dispose().then(() => {
        disposed = true
      })
    }
    expect(await outcome).toMatchObject(
      source === 'settlement' ? { value: { action: 'decline' } } : { error: expect.any(Error) },
    )
    expect(prompt.mock.calls[0]?.[0].signal.aborted).toBe(true)
    try {
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
      if (source === 'shutdown') expect(disposed).toBe(false)
    } finally {
      gate.resolve({ action: 'accept', content: { value: 'late' } })
      await disposing
    }
    if (source === 'caller') {
      expect(host.inbox.get(item.id)).toEqual(item)
      await expect(controller.prompt(item.id, new AbortController().signal)).resolves.toEqual({
        action: 'accept',
      })
    } else if (source === 'shutdown') {
      expect(host.inbox.get(item.id)).toEqual(item)
      expect(adapter.dispose).toHaveBeenCalledTimes(1)
      await expect(controller.prompt(item.id, caller.signal)).rejects.toThrow('disposed')
    } else expect(host.inbox.list()).toEqual([])
  },
)
test('shutdown waits for an outstanding notification and disposes the adapter once', async () => {
  const gate = deferred<void>()
  const { controller, adapter } = setup({ adapter: { notify: () => gate.promise } })
  controller.restored([first])
  let done = false
  const disposing = controller.dispose().then(() => {
    done = true
  })
  await Promise.resolve()
  expect(adapter.dispose).toHaveBeenCalledTimes(1)
  expect(done).toBe(false)
  gate.resolve()
  await disposing
  await controller.dispose()
  expect(adapter.dispose).toHaveBeenCalledTimes(1)
})

test('adapter disposal failure still drains notifications before rejecting shutdown', async () => {
  const gate = deferred<void>()
  const failure = new Error('Adapter disposal failed')
  const { controller } = setup({
    adapter: {
      notify: () => gate.promise,
      dispose: () => {
        throw failure
      },
    },
  })
  // This deliberately failing adapter is disposed here, rather than in the common cleanup.
  cleanup.pop()
  controller.restored([first])
  let done = false
  const disposal = controller.dispose().then(
    () => {
      done = true
    },
    (error: unknown) => {
      done = true
      return error
    },
  )
  await Promise.resolve()
  await Promise.resolve()
  expect(done).toBe(false)
  gate.resolve()
  expect(await disposal).toMatchObject({ name: 'AggregateError', errors: [failure] })
})

test.each(['active', 'caller-cancelled'] as const)(
  'shutdown drains the %s adapter prompt before reporting adapter disposal failure',
  async (state) => {
    const { host, item } = await runtime()
    const gate = deferred<ElicitResult>()
    const prompt = vi.fn<FlowDesktopAdapter['prompt']>().mockReturnValue(gate.promise)
    const failure = new Error('Adapter disposal failed')
    const { controller } = setup({
      host,
      adapter: {
        prompt,
        dispose: () => {
          throw failure
        },
      },
    })
    // The failing disposer is observed here instead of by the common cleanup.
    cleanup.pop()
    const caller = new AbortController()
    const answer = controller.prompt(item.id, caller.signal).catch((error: unknown) => error)
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    if (state === 'caller-cancelled') {
      caller.abort(new Error('Disconnected'))
      expect(await answer).toMatchObject({ message: 'Disconnected' })
      expect(host.inbox.get(item.id)).toEqual(item)
    }
    let disposed = false
    const disposal = controller.dispose().then(
      () => {
        disposed = true
      },
      (error: unknown) => {
        disposed = true
        return error
      },
    )
    expect(await answer).toBeInstanceOf(Error)
    expect(prompt.mock.calls[0]?.[0].signal.aborted).toBe(true)
    try {
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
      expect(disposed).toBe(false)
      expect(host.inbox.get(item.id)).toEqual(item)
    } finally {
      gate.resolve({ action: 'accept', content: { value: 'late' } })
    }
    expect(await disposal).toMatchObject({ name: 'AggregateError', errors: [failure] })
    expect(host.inbox.get(item.id)).toEqual(item)
  },
)

test.each([
  ['restored', (controller: FlowDesktopController, item: InboxItem) => controller.restored([item])],
  [
    'added',
    (controller: FlowDesktopController, item: InboxItem) => {
      controller.restored([])
      controller.added(item)
    },
  ],
] as const)('clicking a %s item notification opens its desktop prompt', async (_name, show) => {
  const { host, item, connect } = await runtime()
  const prompt = vi.fn<FlowDesktopAdapter['prompt']>(async () => ({
    action: 'accept',
    content: { value: 'Ada' },
  }))
  const { controller, adapter, errors } = setup({ host, adapter: { prompt } })
  connect(controller)
  show(controller, item)
  await vi.waitFor(() => expect(adapter.notify).toHaveBeenCalledTimes(1))
  notifyOptions(adapter).onClick?.()
  await vi.waitFor(() => expect(host.inbox.list()).toEqual([]))
  expect(prompt).toHaveBeenCalledTimes(1)
  expect(prompt.mock.calls[0]?.[0].params.message).toBe('Choose')
  expect(errors).toEqual([])
})
test('clicking the pending summary opens no prompt', async () => {
  const { controller, adapter } = setup()
  controller.restored([first, second])
  notifyOptions(adapter).onClick?.()
  await controller.dispose()
  expect(adapter.prompt).not.toHaveBeenCalled()
})
test('a competing request preserves the click-opened dialog and its notification', async () => {
  const { host, item, connect } = await runtime()
  const gate = deferred<ElicitResult>()
  const prompt = vi.fn<FlowDesktopAdapter['prompt']>(() => gate.promise)
  const { controller, adapter, errors } = setup({ host, adapter: { prompt } })
  connect(controller)
  controller.restored([item])
  const notification = notifyOptions(adapter)
  notification.onClick?.()
  try {
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    const dialog = prompt.mock.calls[0]?.[0]
    expect(dialog?.signal.aborted).toBe(false)
    await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toMatchObject({
      name: 'InboxPromptInProgressError',
    })
    expect(dialog?.signal.aborted).toBe(false)
    expect(notification.signal?.aborted).toBe(false)
    expect(host.inbox.get(item.id)).toEqual(item)
    expect(errors).toEqual([])
  } finally {
    gate.resolve({ action: 'accept', content: { value: 'Ada' } })
  }
  await vi.waitFor(() => expect(host.inbox.list()).toEqual([]))
  expect(notification.signal?.aborted).toBe(true)
  expect(prompt).toHaveBeenCalledTimes(1)
  expect(errors).toEqual([])
})
test('click prompt errors never escape and expected ones are not reported', async () => {
  const { host, item } = await runtime()
  const gate = deferred<ElicitResult>()
  const prompt = vi.fn<FlowDesktopAdapter['prompt']>(() => gate.promise)
  const { controller, adapter, errors } = setup({ host, adapter: { prompt } })
  controller.restored([item])
  const onClick = notifyOptions(adapter).onClick
  onClick?.()
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
  // A second click while the prompt is open hits the in-progress guard
  onClick?.()
  await Promise.resolve()
  gate.resolve({ action: 'accept', content: {} })
  // Invalid content rejects the prompt: reported, not thrown
  await vi.waitFor(() => expect(errors).toHaveLength(1))
  expect(errors[0]).toBeInstanceOf(InboxAnswerInvalidError)
  expect(host.inbox.get(item.id)).toEqual(item)
})
test('a click on an unpromptable item is ignored', async () => {
  const { host, item } = await runtime()
  const canPrompt = vi.fn(() => false)
  const { controller, adapter, errors } = setup({ host, adapter: { canPrompt } })
  controller.restored([item])
  notifyOptions(adapter).onClick?.()
  await vi.waitFor(() => expect(canPrompt).toHaveBeenCalledTimes(1))
  // Let the rejected click prompt reach its handler before asserting
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(adapter.prompt).not.toHaveBeenCalled()
  expect(errors).toEqual([])
})

function monitor(
  options: { visible?: boolean; canNotify?: boolean; frozen?: boolean; shown?: boolean } = {},
) {
  const presence = createMonitorPresence()
  const { attachmentID } = presence.attach('http://127.0.0.1:4000/')
  const messages: Array<{ type: string; attemptID?: string }> = []
  const tab = presence.connect(attachmentID, {
    close() {},
    send(message) {
      messages.push(message)
      if (message.type === 'ping' && !options.frozen)
        tab.receive({ type: 'pong', nonce: message.nonce })
      if (message.type === 'notify' || message.type === 'prompt')
        tab.receive({ type: 'ack', attemptID: message.attemptID, shown: options.shown ?? true })
    },
  })
  tab.receive({
    type: 'state',
    visible: options.visible ?? false,
    canNotify: options.canNotify ?? true,
  })
  cleanup.push(async () => presence.dispose())
  return { surface: createMonitorSurface(presence), messages, tab }
}

test('verified monitor attention suppresses native notifications', async () => {
  const { surface } = monitor({ visible: true })
  const { controller, adapter } = setup({ surfaces: [surface] })
  controller.restored([])
  controller.added(second)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(surface.status()).toBe('attended')
  expect(adapter.notify).not.toHaveBeenCalled()
  await controller.dispose()
})

test.each([true, false])(
  'a frozen visible monitor with canNotify=%s falls back to native after five seconds',
  async (canNotify) => {
    vi.useFakeTimers()
    const { surface, messages } = monitor({ visible: true, canNotify, frozen: true })
    const { controller, adapter } = setup({ surfaces: [surface] })
    controller.restored([])
    controller.added(second)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(adapter.notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(adapter.notify).toHaveBeenCalledTimes(1)
    expect(messages.map((message) => message.type)).toEqual(['ping'])
  },
)

test.each([true, false])(
  'monitor notification shown=%s controls native fallback',
  async (shown) => {
    const { surface, messages } = monitor({ shown })
    const { controller, adapter } = setup({ surfaces: [surface] })
    controller.restored([])
    controller.added(second)
    await vi.waitFor(() => expect(messages.some((message) => message.type === 'notify')).toBe(true))
    if (!shown) await vi.waitFor(() => expect(adapter.notify).toHaveBeenCalledTimes(1))
    else {
      await controller.dispose()
      expect(adapter.notify).not.toHaveBeenCalled()
      expect(messages.some((message) => message.type === 'withdraw')).toBe(true)
    }
  },
)

test('native notification opt-out leaves monitor notifications enabled', async () => {
  const { surface, messages } = monitor()
  const { controller, adapter } = setup({ surfaces: [surface], notifications: false })
  controller.restored([])
  controller.added(second)
  await vi.waitFor(() => expect(messages.some((message) => message.type === 'notify')).toBe(true))
  controller.settled(second, 'answered')
  expect(messages.some((message) => message.type === 'withdraw')).toBe(true)
  expect(adapter.notify).not.toHaveBeenCalled()
})

test('restored items notify natively even with an attended monitor', async () => {
  const { surface, messages } = monitor({ visible: true })
  const { controller, adapter } = setup({ surfaces: [surface] })
  controller.restored([second])
  expect(adapter.notify).toHaveBeenCalledTimes(1)
  expect(messages).toEqual([])
})

test.each([
  ['answered', 'accept'],
  ['declined', 'decline'],
  ['cancelled', 'cancel'],
  ['withdrawn', null],
] satisfies Array<[InboxOutcome, string | null]>)(
  'monitor prompt observes %s settlement',
  async (settlement, action) => {
    const { host, item, connect } = await runtime()
    const { surface, messages } = monitor({ visible: true })
    const { controller, adapter } = setup({ host, surfaces: [surface] })
    connect(controller)
    const prompting = controller.prompt(item.id, new AbortController().signal)
    const observed = prompting.catch((error: unknown) => error)
    await vi.waitFor(() => expect(messages.some((message) => message.type === 'prompt')).toBe(true))
    controller.settled(item, settlement)
    if (action == null) expect(await observed).toMatchObject({ name: 'InboxItemNotFoundError' })
    else expect(await observed).toEqual({ action })
    expect(messages.some((message) => message.type === 'withdraw')).toBe(true)
    expect(adapter.prompt).not.toHaveBeenCalled()
  },
)

test('monitor target loss falls back to the native dialog', async () => {
  const { host, item, connect } = await runtime()
  const { surface, messages, tab } = monitor({ visible: true })
  const { controller, adapter } = setup({
    host,
    surfaces: [surface],
    adapter: {
      prompt: vi.fn<FlowDesktopAdapter['prompt']>(async () => ({
        action: 'accept',
        content: { value: 'Ada' },
      })),
    },
  })
  connect(controller)
  const prompting = controller.prompt(item.id, new AbortController().signal)
  await vi.waitFor(() => expect(messages.some((message) => message.type === 'prompt')).toBe(true))
  tab.disconnect()
  await expect(prompting).resolves.toEqual({ action: 'accept' })
  expect(adapter.prompt).toHaveBeenCalledTimes(1)
})

test('caller abort withdraws a monitor prompt and immediately releases ownership', async () => {
  const { host, item, connect } = await runtime()
  const { surface, messages } = monitor({ visible: true })
  const { controller } = setup({ host, surfaces: [surface] })
  connect(controller)
  const caller = new AbortController()
  const prompting = controller.prompt(item.id, caller.signal).catch((error: unknown) => error)
  await vi.waitFor(() => expect(messages.some((message) => message.type === 'prompt')).toBe(true))
  await expect(controller.prompt(item.id, new AbortController().signal)).rejects.toMatchObject({
    name: 'InboxPromptInProgressError',
  })
  caller.abort(new Error('Disconnected'))
  expect(await prompting).toMatchObject({ message: 'Disconnected' })
  expect(messages.some((message) => message.type === 'withdraw')).toBe(true)
  expect(host.inbox.get(item.id)).toEqual(item)
  const next = controller.prompt(item.id, new AbortController().signal)
  await vi.waitFor(() =>
    expect(messages.filter((message) => message.type === 'prompt')).toHaveLength(2),
  )
  await host.inbox.decline(item.id)
  await expect(next).resolves.toEqual({ action: 'decline' })
})

test('settlement during delivery wins over fallback and closes a late delivery', async () => {
  const { host, item, connect } = await runtime()
  const gate = deferred<Awaited<ReturnType<NonNullable<InboxSurface['prompt']>>>>()
  const started = deferred<void>()
  const close = vi.fn()
  const surface: InboxSurface = {
    name: 'delayed',
    status: () => 'reachable',
    isAttended: async () => false,
    notify: async () => null,
    prompt: () => {
      started.resolve()
      return gate.promise
    },
  }
  const { controller, adapter } = setup({ host, surfaces: [surface] })
  connect(controller)
  const prompting = controller.prompt(item.id, new AbortController().signal)
  await started.promise
  await host.inbox.decline(item.id)
  await expect(prompting).resolves.toEqual({ action: 'decline' })
  gate.resolve({ close, closed: Promise.resolve() })
  await vi.waitFor(() => expect(close).toHaveBeenCalled())
  expect(adapter.prompt).not.toHaveBeenCalled()
})

test('settlement while monitor notify is pending prevents native fallback', async () => {
  const gate = deferred<null>()
  const entered = deferred<void>()
  const surface: InboxSurface = {
    name: 'delayed',
    status: () => 'reachable',
    isAttended: async () => false,
    notify: () => {
      entered.resolve()
      return gate.promise
    },
  }
  const { controller, adapter } = setup({ surfaces: [surface] })
  controller.restored([])
  controller.added(second)
  await entered.promise
  controller.settled(second, 'answered')
  gate.resolve(null)
  await controller.dispose()
  expect(adapter.notify).not.toHaveBeenCalled()
})

test('settlement closes both notification and prompt deliveries for the item', async () => {
  const { host, item, connect } = await runtime()
  const { surface, messages } = monitor({ visible: false })
  const { controller } = setup({ host, surfaces: [surface] })
  connect(controller)
  controller.restored([])
  controller.added(item)
  await vi.waitFor(() => expect(messages.some((message) => message.type === 'notify')).toBe(true))
  const prompting = controller.prompt(item.id, new AbortController().signal)
  await vi.waitFor(() => expect(messages.some((message) => message.type === 'prompt')).toBe(true))
  await host.inbox.decline(item.id)
  await expect(prompting).resolves.toEqual({ action: 'decline' })
  const withdrawn = messages
    .filter((message) => message.type === 'withdraw')
    .map((message) => message.attemptID)
  const attempts = messages
    .filter((message) => message.type === 'notify' || message.type === 'prompt')
    .map((message) => message.attemptID)
  expect(withdrawn.sort()).toEqual(attempts.sort())
})

test('settlement markers are released once a pending notification attempt finishes', async () => {
  const gate = deferred<null>()
  const entered = deferred<void>()
  const surface: InboxSurface = {
    name: 'delayed',
    status: () => 'reachable',
    isAttended: async () => false,
    notify: () => {
      entered.resolve()
      return gate.promise
    },
  }
  const { controller } = setup({ surfaces: [surface] })
  controller.restored([])
  controller.added(second)
  await entered.promise
  const add = vi.spyOn(Set.prototype, 'add')
  controller.settled(second, 'answered')
  const marker = add.mock.contexts[add.mock.calls.findIndex(([value]) => value === second.id)]
  add.mockRestore()
  expect(marker).toBeInstanceOf(Set)
  if (!(marker instanceof Set)) throw new Error('Missing settlement marker set')
  expect(marker.has(second.id)).toBe(true)
  gate.resolve(null)
  await controller.dispose()
  expect(marker.has(second.id)).toBe(false)
})

test('settlement without attempts or owners retains no marker', () => {
  const { controller } = setup()
  const add = vi.spyOn(Set.prototype, 'add')
  controller.settled(first, 'withdrawn')
  const marker = add.mock.contexts[add.mock.calls.findIndex(([value]) => value === first.id)]
  add.mockRestore()
  expect(marker).toBeInstanceOf(Set)
  if (!(marker instanceof Set)) throw new Error('Missing settlement marker set')
  expect(marker.has(first.id)).toBe(false)
})
