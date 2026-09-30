import { isDeepStrictEqual } from 'node:util'
import type { DetailedTask, InputResponse } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { test } from 'vitest'

import {
  createTaskManager,
  InputRequestWithdrawnError,
  type TaskHandle,
} from '../src/task-manager.js'
import type { TaskRecord } from '../src/task-store.js'
import type { GenericToolDefinition } from '../src/types.js'
import { createScheduledStore, mulberry32 } from './support/scheduled-store.js'

const SEEDS = Number(process.env.TASK_INPUT_SEEDS ?? 500)

const tool: GenericToolDefinition = {
  description: 'Test tool',
  inputSchema: { type: 'object' },
  handler: () => ({ content: [] }),
}
const requests = {
  a: { method: 'roots/list' as const },
  b: { method: 'roots/list' as const },
}
const responses: Record<'a' | 'b', InputResponse> = {
  a: { roots: [{ uri: 'file:///a' }] },
  b: { roots: [{ uri: 'file:///b' }] },
}
// A waiter registering while a cancel commits may see the terminal record before the abort.
const TERMINAL_REASONS = ['Task cancelled', 'Task is no longer active']

type Settlement =
  | { state: 'pending' }
  | { state: 'fulfilled'; value: unknown }
  | { state: 'rejected'; error: unknown }

function track(promise: Promise<unknown>): Settlement {
  const settlement: Settlement = { state: 'pending' }
  promise.then(
    (value) => Object.assign(settlement, { state: 'fulfilled', value }),
    (error: unknown) => Object.assign(settlement, { state: 'rejected', error }),
  )
  return settlement
}

function isTerminal(record: TaskRecord | undefined): boolean {
  return (
    record?.status === 'completed' || record?.status === 'failed' || record?.status === 'cancelled'
  )
}

function isOpen(record: TaskRecord | undefined): boolean {
  return record?.status === 'input_required' && record.inputs.at(-1)?.outcome === undefined
}

test.each(Array.from({ length: SEEDS }, (_, seed) => seed))(
  'task input invariants hold for seed %i',
  async (seed) => {
    const fail = (message: string): never => {
      throw new Error(`seed ${seed}: ${message}`)
    }
    const { store, commits, drain } = createScheduledStore(seed)
    const manager = createTaskManager({ store })
    const events: Array<DetailedTask> = []
    const errors: Array<unknown> = []
    manager.events.on('taskStatus', (event) => {
      events.push(event)
    })
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) fail('worker did not start')
    const worker = handle as TaskHandle
    const taskID = created.taskId

    const choose = mulberry32(seed ^ 0x9e3779b9)
    const controller = new AbortController()
    const abortReason = new Error('deadline')
    const signalled = track(worker.requestInput(requests, { signal: controller.signal }))
    const duplicate = track(worker.requestInput(requests))
    const others: Array<Settlement> = []
    const rpcOthers: Array<Settlement> = []
    if (choose() < 0.5) rpcOthers.push(track(manager.update(taskID, { a: responses.a })))
    if (choose() < 0.5) rpcOthers.push(track(manager.update(taskID, { b: responses.b })))
    // The abort waits on a scheduled read, so the scheduler places it among the writes.
    if (choose() < 0.5)
      others.push(track(store.get(taskID).then(() => controller.abort(abortReason))))
    if (choose() < 0.5) others.push(track(manager.cancel(taskID)))

    await drain()

    commits.forEach((record, index) => {
      if ((record.status === 'input_required') !== isOpen(record))
        fail(
          `commit ${index} has status ${record.status} with latest ${JSON.stringify(record.inputs.at(-1))}`,
        )
    })
    events.forEach((event, index) => {
      if ('inputRequests' in event && Object.keys(event.inputRequests ?? {}).length === 0)
        fail(`taskStatus event ${index} has empty inputRequests`)
    })
    if (errors.length > 0) fail(`unexpected taskError events: ${String(errors)}`)
    for (const settlement of others)
      if (settlement.state !== 'fulfilled')
        fail(`abort or cancel did not settle: ${settlement.state}`)
    for (const settlement of rpcOthers)
      if (
        settlement.state === 'pending' ||
        (settlement.state === 'rejected' && !(settlement.error instanceof RPCError))
      )
        fail(`update settled as ${settlement.state}`)

    const final = commits.at(-1)
    const entry = final?.inputs.at(-1)
    const terminal = isTerminal(final)
    for (const [name, settlement] of [
      ['signalled', signalled],
      ['duplicate', duplicate],
    ] as const) {
      if (settlement.state === 'pending') {
        if (!isOpen(final)) fail(`${name} is pending while no request is open`)
      } else if (settlement.state === 'fulfilled') {
        if (entry?.outcome !== 'answered' || !isDeepStrictEqual(settlement.value, entry.responses))
          fail(`${name} resolved while the final entry is ${JSON.stringify(entry)}`)
      } else if (settlement.error instanceof InputRequestWithdrawnError) {
        if (entry?.outcome !== 'withdrawn' || settlement.error.id !== entry.id)
          fail(`${name} was withdrawn while the final entry is ${JSON.stringify(entry)}`)
      } else if (name === 'signalled' && settlement.error === abortReason) {
        // Aborted before this call issued the request: it throws the reason without writing, and
        // never attaches, so nothing withdraws the request the duplicate may have issued.
        if (entry?.outcome === 'withdrawn') fail('signalled threw its abort reason but withdrew')
      } else if (
        !terminal ||
        !(settlement.error instanceof Error) ||
        !TERMINAL_REASONS.includes(settlement.error.message)
      ) {
        fail(`${name} rejected with ${String(settlement.error)} while status is ${final?.status}`)
      }
    }

    await manager.dispose()
  },
)
