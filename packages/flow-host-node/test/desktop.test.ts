import type { ElicitResult } from '@mokei/context-protocol'
import type { FlowHost, InboxItem } from '@mokei/flow-host'
import { createFlowHost, InboxAnswerInvalidError } from '@mokei/flow-host'
import { Session } from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import type { FlowDesktopAdapter, FlowDesktopController } from '../src/desktop.js'
import { createFlowDesktopController } from '../src/desktop.js'

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
})
function setup(
  options: { notifications?: boolean; host?: FlowHost; adapter?: Partial<FlowDesktopAdapter> } = {},
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
  const controller = createFlowDesktopController({
    adapter,
    notifications: options.notifications ?? true,
    host: () => {
      if (options.host == null) throw new Error('Unexpected host access')
      return options.host
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
  controller.settled(first)
  controller.added(first)
  controller.added(second)
  controller.added({ ...second, id: 'three:input' })
  controller.added({ ...second, id: 'three:input' })
  gate.resolve()
  await controller.dispose()
  expect(vi.mocked(adapter.notify).mock.calls).toEqual([
    ['2 pending prompts'],
    ['Flow needs your input'],
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
    listeners: { 'inbox:settled': ({ item }) => controller?.settled(item) },
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
  const { host, item } = await runtime()
  const gate = deferred<Awaited<ReturnType<FlowHost['get']>>>()
  const lookup = vi.spyOn(host, 'get').mockReturnValueOnce(gate.promise)
  const { controller } = setup({ host, adapter: { prompt: async () => ({ action: 'cancel' }) } })
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
    if (source === 'caller') caller.abort(new Error('Disconnected'))
    else if (source === 'settlement') await host.inbox.decline(item.id)
    else await controller.dispose()
    expect(await outcome).toMatchObject({ error: expect.any(Error) })
    expect(prompt.mock.calls[0]?.[0].signal.aborted).toBe(true)
    gate.resolve({ action: 'accept', content: { value: 'late' } })
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
