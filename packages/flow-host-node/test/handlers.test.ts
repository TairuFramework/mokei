import { Client } from '@enkaku/client'
import { createServerMessageSchema } from '@enkaku/protocol'
import { serve } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import { randomIdentity } from '@kokuin/token'
import { createMemoryTaskStore } from '@mokei/context-server'
import { createFlowHost, createMemoryRunStore, createMemoryTraceStore } from '@mokei/flow-host'
import type {
  ClientMessage,
  FlowServiceStatus,
  Protocol,
  ServerMessage,
} from '@mokei/host-protocol'
import { protocol } from '@mokei/host-protocol'
import { Session } from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { createValidator } from '@sozai/schema'
import { afterEach, expect, test, vi } from 'vitest'

import {
  createFlowDesktopController,
  DesktopPromptUnavailableError,
  InboxPromptInProgressError,
} from '../src/desktop.js'
import { createFlowHandlers } from '../src/index.js'
import type { FlowService } from '../src/service.js'
import { FlowServiceUnavailableError } from '../src/service.js'
import { inputFlow, predictor } from './support/input-flow.js'
import { logRecord, runRecord, spanRecord } from './support/records.js'

const emptyFlow: FlowDefinition = {
  id: 'empty',
  name: 'Empty',
  version: 1,
  start: 'done',
  nodes: { done: { kind: 'end', outcome: 'done' } },
}
const toolFlow: FlowDefinition = {
  ...emptyFlow,
  id: 'tool',
  name: 'Tool',
  start: 'echo',
  nodes: {
    echo: { kind: 'tool', tool: 'local:echo', args: {}, next: 'done' },
    done: { kind: 'end', outcome: 'done' },
  },
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.restoreAllMocks()
})

async function setup() {
  const session = new Session({ elicit: true })
  let executions = 0
  session.contextHost.addLocalTool({
    name: 'echo',
    inputSchema: { type: 'object' },
    execute: () => {
      executions++
      return { content: [] }
    },
  })
  const runStore = createMemoryRunStore()
  const traceStore = createMemoryTraceStore()
  const host = await createFlowHost({
    session,
    flows: [emptyFlow, toolFlow, inputFlow],
    predictor,
    runStore,
    taskStore: createMemoryTaskStore(),
    pollMs: 10,
  })
  let status: FlowServiceStatus = { state: 'ready' }
  let stopping = false
  const operations = new Set<Promise<unknown>>()
  const desktop = createFlowDesktopController({
    notifications: false,
    host: () => host,
    onError: () => {},
    adapter: {
      canPrompt: () => true,
      prompt: async () => ({ action: 'decline' }),
      notify: async () => {},
      dispose: async () => {},
    },
  })
  const service: FlowService = {
    status: () => status,
    resources() {
      if (stopping || status.state !== 'ready')
        throw new FlowServiceUnavailableError({ status, stopping })
      return { host, traceStore }
    },
    run: vi.fn(async (work) => {
      const resources = service.resources()
      const operation = Promise.resolve().then(() => work(resources))
      operations.add(operation)
      try {
        return await operation
      } finally {
        operations.delete(operation)
      }
    }),
    start: async () => {},
    prompt: vi.fn((id, signal) => desktop.prompt(id, signal)),
    async dispose() {
      stopping = true
      await desktop.dispose()
      await Promise.allSettled([...operations])
      await host.dispose()
      await session.dispose()
    },
  }
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  const validate = createValidator(createServerMessageSchema(protocol))
  const invalidMessages: Array<unknown> = []
  const read = pair.client.read.bind(pair.client)
  vi.spyOn(pair.client, 'read').mockImplementation(async () => {
    const next = await read()
    if (!next.done) {
      const checked = validate(next.value)
      if (checked.issues) invalidMessages.push(checked.issues)
    }
    return next
  })
  const identity = randomIdentity()
  const server = serve<Protocol>({
    protocol,
    handlers: {
      ...createFlowHandlers(service),
      info: () => ({ activeContexts: {}, startedTime: 0, flowService: status }),
      events: () => {},
      shutdown: () => {},
      spawn: () => {},
      'monitor.attach': () => {},
      'monitor.presence': () => {},
    },
    identity,
    accessRules: { '*': { allow: true } },
    transport: pair.server,
  })
  const client = new Client<Protocol>({
    transport: pair.client,
    identity: randomIdentity(),
    serverID: identity.id,
  })
  cleanups.push(async () => {
    await client.dispose()
    await server.dispose()
    await pair.dispose()
    await service.dispose()
    expect(invalidMessages).toEqual([])
  })
  return {
    client,
    host,
    service,
    runStore,
    traceStore,
    setStatus: (next: FlowServiceStatus) => {
      status = next
    },
    executions: () => executions,
  }
}

test('projects validation without runtime closures', async () => {
  const { client } = await setup()
  const result = await client.request('flows.check', { param: { definition: emptyFlow } })
  expect(result).toEqual({ value: emptyFlow, warnings: [], formatted: '' })
  expect(result).not.toHaveProperty('graphFor')
  expect(result).not.toHaveProperty('lookup')
  const invalid = await client.request('flows.check', { param: { definition: {} } })
  expect(invalid).toHaveProperty('issues')
  expect(invalid).not.toHaveProperty('graphFor')
})

test('lists flows and enforces the same approval for registered and inline starts', async () => {
  const { client, executions } = await setup()
  expect(await client.request('flows.list')).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'tool' })]),
  )
  const registered = await client.request('runs.start', {
    param: { flow: 'tool', label: 'Registered' },
  })
  const inline = await client.request('runs.start', {
    param: { definition: toolFlow, label: 'Inline' },
  })
  expect(registered.state).toBe('awaiting_approval')
  expect(inline.state).toBe('awaiting_approval')
  expect(registered.plan).toEqual(inline.plan)
  expect(executions()).toBe(0)
  expect(await client.request('runs.get', { param: { runID: registered.runID } })).toEqual(
    registered,
  )
  expect(
    await client.request('runs.list', { param: { states: ['awaiting_approval'], limit: 1 } }),
  ).toHaveLength(1)
  const items = await client.request('inbox.list', { param: { runID: registered.runID } })
  const item = items[0]
  if (item == null) throw new Error('Missing approval')
  expect(await client.request('inbox.get', { param: { id: item.id } })).toEqual(item)
  expect(await client.request('inbox.answer', { param: { id: item.id } })).toEqual({
    settled: true,
  })
  expect(executions()).toBe(1)
  expect(await client.request('runs.cancel', { param: { runID: inline.runID } })).toMatchObject({
    state: 'cancelled',
  })
})

test('invalid answers preserve pending input and valid answers settle it', async () => {
  const { client } = await setup()
  const run = await client.request('runs.start', { param: { flow: 'input' } })
  let id = ''
  await vi.waitFor(async () => {
    const items = await client.request('inbox.list', { param: { runID: run.runID } })
    expect(items[0]).toMatchObject({ kind: 'input' })
    id = items[0]?.id ?? ''
  })
  await expect(
    client.request('inbox.answer', { param: { id, content: { value: 12 } } }),
  ).rejects.toMatchObject({
    code: 'INBOX_ANSWER_INVALID',
    data: { issues: expect.any(Array) },
  })
  expect(await client.request('inbox.get', { param: { id } })).toMatchObject({ id, kind: 'input' })
  expect(
    await client.request('inbox.answer', { param: { id, content: { value: 'answer' } } }),
  ).toEqual({ settled: true })
  await vi.waitFor(async () =>
    expect(await client.request('runs.get', { param: { runID: run.runID } })).toMatchObject({
      state: 'completed',
    }),
  )
})

test('returns settlement acknowledgements for decline, cancel and prompt', async () => {
  const { client } = await setup()
  for (const procedure of ['inbox.decline', 'inbox.cancel', 'inbox.prompt'] as const) {
    const run = await client.request('runs.start', { param: { flow: 'tool' } })
    const item = (await client.request('inbox.list', { param: { runID: run.runID } }))[0]
    if (item == null) throw new Error('Missing approval')
    const result = await client.request(procedure, { param: { id: item.id } })
    expect(result).toEqual(procedure === 'inbox.prompt' ? { action: 'decline' } : { settled: true })
    expect(await client.request('inbox.list', { param: { runID: run.runID } })).toEqual([])
  }
})

test('distinguishes absent records and invalid definitions', async () => {
  const { client } = await setup()
  await expect(client.request('runs.start', { param: { flow: 'absent' } })).rejects.toMatchObject({
    code: 'FLOW_NOT_FOUND',
  })
  await expect(client.request('runs.start', { param: { definition: {} } })).rejects.toMatchObject({
    code: 'FLOW_INVALID',
    data: { issues: expect.any(Array) },
  })
  for (const procedure of ['runs.get', 'runs.cancel', 'runs.trace'] as const) {
    await expect(client.request(procedure, { param: { runID: 'absent' } })).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    })
  }
  await expect(client.request('inbox.get', { param: { id: 'absent' } })).rejects.toMatchObject({
    code: 'INBOX_ITEM_NOT_FOUND',
  })
})

test('reads only the stored trace belonging to an existing run', async () => {
  const { client, runStore, traceStore } = await setup()
  await runStore.create(runRecord({ runID: 'no-trace', state: 'completed' }))
  await runStore.create(runRecord({ runID: 'traced', state: 'completed', traceID: 'trace-one' }))
  const span = spanRecord()
  const log = logRecord()
  await traceStore.addSpans([span, spanRecord({ traceID: 'other', spanID: 'other' })])
  await traceStore.addLogs([log, logRecord({ traceID: 'other' })])
  expect(await client.request('runs.trace', { param: { runID: 'no-trace' } })).toEqual({
    spans: [],
    logs: [],
  })
  expect(await client.request('runs.trace', { param: { runID: 'traced' } })).toEqual({
    spans: [span],
    logs: [log],
  })
})

test.each<FlowServiceStatus>([
  { state: 'starting' },
  { state: 'failed', error: { type: 'Config', message: 'Invalid config' } },
])('gates every flow procedure while $state', async (status) => {
  const { client, service, setStatus } = await setup()
  setStatus(status)
  const requests = [
    () => client.request('flows.list'),
    () => client.request('flows.check', { param: { definition: emptyFlow } }),
    () => client.request('runs.start', { param: { flow: 'empty' } }),
    () => client.request('runs.get', { param: { runID: 'unknown' } }),
    () => client.request('runs.list', { param: {} }),
    () => client.request('runs.cancel', { param: { runID: 'unknown' } }),
    () => client.request('runs.trace', { param: { runID: 'unknown' } }),
    () => client.request('inbox.list', { param: {} }),
    () => client.request('inbox.get', { param: { id: 'unknown' } }),
    () => client.request('inbox.answer', { param: { id: 'unknown' } }),
    () => client.request('inbox.decline', { param: { id: 'unknown' } }),
    () => client.request('inbox.cancel', { param: { id: 'unknown' } }),
    () => client.request('inbox.prompt', { param: { id: 'unknown' } }),
  ]
  for (const request of requests)
    await expect(request()).rejects.toMatchObject({ code: 'FLOW_UNAVAILABLE' })
  expect(service.run).toHaveBeenCalledTimes(13)
})

test('hides unexpected exception messages', async () => {
  const { client, host } = await setup()
  const error = new Error('password=secret')
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(host, 'flows').mockImplementation(() => {
    throw error
  })
  await expect(client.request('flows.list')).rejects.toMatchObject({
    code: 'INTERNAL_ERROR',
    message: 'Flow request failed',
  })
  expect(report).toHaveBeenCalledWith('[@mokei/flow-host-node] Flow request failed', error)
})

test('passes the request cancellation signal to the prompt service', async () => {
  const { client, service } = await setup()
  let signal: AbortSignal | undefined
  vi.mocked(service.prompt).mockImplementation(async (_, caller) => {
    signal = caller
    await new Promise<void>((resolve) =>
      caller.addEventListener('abort', () => resolve(), { once: true }),
    )
    return { action: 'cancel' }
  })
  const controller = new AbortController()
  const request = client.request('inbox.prompt', {
    param: { id: 'item' },
    signal: controller.signal,
  })
  void request.catch(() => {})
  await vi.waitFor(() => expect(signal).toBeDefined())
  controller.abort()
  await expect(request).rejects.toBeDefined()
  await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  expect(service.run).toHaveBeenCalledTimes(1)
})

test('maps unsupported and already owned desktop prompts', async () => {
  const { client, service } = await setup()
  vi.mocked(service.prompt).mockRejectedValueOnce(new DesktopPromptUnavailableError('item'))
  await expect(client.request('inbox.prompt', { param: { id: 'item' } })).rejects.toMatchObject({
    code: 'PROMPT_UNSUPPORTED',
  })
  vi.mocked(service.prompt).mockRejectedValueOnce(new InboxPromptInProgressError('item'))
  await expect(client.request('inbox.prompt', { param: { id: 'item' } })).rejects.toMatchObject({
    code: 'PROMPT_IN_PROGRESS',
  })
})

test('keeps an admitted mutation tracked after its caller disconnects', async () => {
  const { client, host, service, runStore } = await setup()
  const run = await client.request('runs.start', { param: { flow: 'tool' } })
  const item = (await client.request('inbox.list', { param: { runID: run.runID } }))[0]
  if (item == null) throw new Error('Missing approval')
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const decline = host.inbox.decline
  let entered = false
  vi.spyOn(host.inbox, 'decline').mockImplementation(async (id, reason) => {
    entered = true
    await hold
    await decline(id, reason)
  })
  const request = client.request('inbox.decline', { param: { id: item.id } })
  void request.catch(() => {})
  await vi.waitFor(() => expect(entered).toBe(true))
  await client.dispose()
  let disposed = false
  const disposal = service.dispose().then(() => {
    disposed = true
  })
  await Promise.resolve()
  expect(disposed).toBe(false)
  release()
  await disposal
  expect((await runStore.get(run.runID))?.state).toBe('denied')
})
