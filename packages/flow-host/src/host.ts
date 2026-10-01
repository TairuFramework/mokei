import type { DetailedTask } from '@mokei/context-protocol'
import type { JSONValue } from '@mokei/context-server'
import { createMemoryTaskStore } from '@mokei/context-server'
import {
  addDecisionFlow,
  createFlowRegistry,
  flowSummaries,
  flowToolName,
} from '@mokei/decision-flow-server'
import { EventEmitter } from '@sozai/event'

import { isAllowed } from './approval.js'
import {
  FlowCheckError,
  FlowNotFoundError,
  InboxItemNotFoundError,
  RunNotFoundError,
} from './errors.js'
import { createInbox } from './inbox.js'
import { createLauncher } from './launch.js'
import { mapTaskSnapshot } from './map-task.js'
import { recoverRuns } from './recovery.js'
import { createMemoryRunStore } from './run-store.js'
import { createRunQueue, TERMINAL_STATES, transition } from './transitions.js'
import type {
  FlowHost,
  FlowHostEvents,
  FlowHostParams,
  FlowRunSnapshot,
  InboxItem,
  RunRecord,
} from './types.js'
import { createWatchers } from './watcher.js'

export function runSnapshot(record: RunRecord): FlowRunSnapshot {
  const {
    revision: _revision,
    request: _request,
    digest: _digest,
    taskID: _taskID,
    traceparent: _traceparent,
    cancelRequested: _cancelRequested,
    ...snapshot
  } = record
  return structuredClone(snapshot)
}

export async function createFlowHost(params: FlowHostParams): Promise<FlowHost> {
  if (!params.session.contextHost.elicitationEnabled)
    throw new Error('Flow host requires elicitation')
  const key = params.key ?? 'flow'
  const registry = createFlowRegistry(params.flows ?? [])
  const summaries = flowSummaries(registry)
  const store = params.runStore ?? createMemoryRunStore()
  const taskStore = params.taskStore ?? createMemoryTaskStore()
  const wiring = await addDecisionFlow(params.session, {
    key,
    flows: params.flows,
    predictor: params.predictor,
    store: taskStore,
  })
  const client = params.session.contextHost.getContext(key).client
  const events = new EventEmitter<FlowHostEvents>()
  const queue = createRunQueue()
  const lastApplied = new Map<string, number>()
  const pendingCancellations = new Map<string, string>()
  function emit<Event extends keyof FlowHostEvents>(event: Event, value: FlowHostEvents[Event]) {
    void events.emit(event, value).catch(() => undefined)
  }
  async function change(
    runID: string,
    compute: (record: RunRecord) => Partial<RunRecord> | undefined,
  ) {
    return queue.run(runID, async () => {
      const result = await transition(store, runID, compute)
      if (result.stateChanged) emit('run:state', runSnapshot(result.record))
      return result.record
    })
  }
  const inbox = createInbox({
    client,
    store,
    queue,
    emit,
    approve: async (runID, id) => {
      await launch(await claim(runID, id))
    },
    rejectApproval: approval,
  })
  async function apply(runID: string, task: DetailedTask): Promise<boolean> {
    const applied = await queue.run(runID, async () => {
      const timestamp = Date.parse(task.lastUpdatedAt)
      let accepted = false
      const unsupported =
        task.status === 'input_required'
          ? Object.values(task.inputRequests).find(
              (request) => request.method !== 'elicitation/create',
            )?.method
          : undefined
      const result = await transition(store, runID, () => {
        if (timestamp < (lastApplied.get(runID) ?? Number.NEGATIVE_INFINITY)) return undefined
        accepted = true
        return unsupported === undefined
          ? mapTaskSnapshot(task)
          : { state: 'failed', error: { type: 'UnsupportedInput', message: unsupported } }
      })
      if (result.changed) lastApplied.set(runID, timestamp)
      if (result.stateChanged) emit('run:state', runSnapshot(result.record))
      const terminal = TERMINAL_STATES.has(result.record.state)
      if (accepted) {
        inbox.reconcile(runID, terminal ? undefined : task)
        if (unsupported !== undefined) pendingCancellations.set(runID, task.taskId)
      }
      return { terminal, accepted }
    })
    // Network calls stay outside the run queue so pending responses cannot block transitions.
    const pendingTaskID = pendingCancellations.get(runID)
    if (pendingTaskID !== undefined) {
      await client.tasks.cancel(pendingTaskID)
      pendingCancellations.delete(runID)
    } else if (applied.accepted && !applied.terminal) {
      await inbox.cancelURLs(runID, task)
    }
    return applied.terminal
  }
  const watchers = createWatchers({
    client,
    pollMs: params.pollMs ?? 500,
    apply,
    interrupted: async (runID) => {
      pendingCancellations.delete(runID)
      await change(runID, () => ({
        state: 'failed',
        error: { type: 'Interrupted', message: 'Task not found' },
      }))
    },
  })
  async function cancelTask(runID: string, taskID: string): Promise<RunRecord> {
    await client.tasks.cancel(taskID)
    const task = await client.tasks.get(taskID)
    await apply(runID, task)
    const record = await store.get(runID)
    if (record === undefined) throw new RunNotFoundError(runID)
    if (!TERMINAL_STATES.has(record.state)) watchers.watch(runID, taskID)
    return record
  }
  const launch = createLauncher({ client, wiring, change, cancelTask, watch: watchers.watch })
  async function claim(runID: string, approvalID?: string): Promise<RunRecord> {
    return queue.run(runID, async () => {
      if (approvalID !== undefined) inbox.requireOpen(approvalID)
      const claimed = await transition(store, runID, (record) =>
        record.state === 'awaiting_approval' ? { state: 'working' } : undefined,
      )
      if (!claimed.changed) throw new InboxItemNotFoundError(approvalID ?? `${runID}:approval`)
      if (claimed.stateChanged) emit('run:state', runSnapshot(claimed.record))
      if (approvalID !== undefined) inbox.settle(approvalID, 'answered')
      return claimed.record
    })
  }
  async function approval(id: string, outcome: 'declined' | 'cancelled', reason?: string) {
    const runID = inbox.requireOpen(id).item.runID
    await queue.run(runID, async () => {
      inbox.requireOpen(id)
      const result = await transition(store, runID, () =>
        outcome === 'declined'
          ? { state: 'denied', error: { type: 'FlowDenied', message: reason ?? 'Flow denied' } }
          : { state: 'cancelled' },
      )
      if (!result.changed) throw new InboxItemNotFoundError(id)
      if (result.stateChanged) emit('run:state', runSnapshot(result.record))
      inbox.settle(id, outcome)
    })
  }
  await recoverRuns({
    store,
    taskStore,
    change,
    addApproval: inbox.add,
    watch: watchers.watch,
    cancelTask,
  })
  let disposed = false
  let disposal: Promise<void> | undefined
  const inFlight = new Set<Promise<unknown>>()
  function requireActive() {
    if (disposed) throw new Error('Flow host disposed')
  }
  async function admitted<T>(work: () => Promise<T>): Promise<T> {
    requireActive()
    const pending = Promise.resolve().then(work)
    inFlight.add(pending)
    try {
      return await pending
    } finally {
      inFlight.delete(pending)
    }
  }
  const host: FlowHost = {
    flows: () => structuredClone(summaries),
    check: wiring.check,
    async start(request) {
      const flow = 'flow' in request ? registry.lookup(request.flow) : undefined
      if ('flow' in request && flow === undefined) throw new FlowNotFoundError(request.flow)
      const resolved =
        'flow' in request
          ? { toolName: flowToolName(request.flow), arguments: request.input ?? {} }
          : {
              toolName: 'run_flow',
              arguments: {
                definition: request.definition,
                ...(request.input !== undefined ? { input: request.input } : {}),
              },
            }
      const storedRequest = structuredClone(resolved) as RunRecord['request'] & {
        arguments: Record<string, JSONValue>
      }
      const authorized = await wiring.authorize(storedRequest)
      if (!authorized.ok) throw new FlowCheckError(authorized.issues)
      const now = Date.now()
      const record: RunRecord = {
        runID: crypto.randomUUID(),
        ...('flow' in request ? { flowID: request.flow } : {}),
        label:
          request.label ??
          flow?.name ??
          ('definition' in request ? request.definition.name : request.flow),
        state: 'awaiting_approval',
        createdAt: now,
        updatedAt: now,
        revision: 0,
        request: storedRequest,
        digest: authorized.digest,
        plan: { tools: [...authorized.plan] },
      }
      const allowed = isAllowed(authorized.plan, params.approval?.allow ?? [])
      const current = await queue.run(record.runID, async () => {
        await store.create(record)
        const current = await store.get(record.runID)
        if (current === undefined) throw new RunNotFoundError(record.runID)
        if (allowed) return current
        emit('run:state', runSnapshot(current))
        if (current.state !== 'awaiting_approval') return current
        const item: InboxItem = {
          id: `${current.runID}:approval`,
          runID: current.runID,
          kind: 'approval',
          plan: structuredClone(current.plan),
          createdAt: current.createdAt,
        }
        inbox.add(item)
        return current
      })
      if (allowed) return runSnapshot(await launch(await claim(current.runID)))
      return runSnapshot(current)
    },
    async get(runID) {
      const record = await store.get(runID)
      return record === undefined ? undefined : runSnapshot(record)
    },
    async list(filter) {
      return (await store.list(filter ?? {})).map(runSnapshot)
    },
    async cancel(runID) {
      const record = await queue.run(runID, async () => {
        const result = await transition(store, runID, (current) => {
          if (current.state === 'awaiting_approval') return { state: 'cancelled' }
          if (current.taskID === undefined) return { cancelRequested: true }
          return undefined
        })
        if (result.stateChanged) {
          emit('run:state', runSnapshot(result.record))
          inbox.settle(`${runID}:approval`, 'cancelled')
        }
        return result.record
      })
      return runSnapshot(
        TERMINAL_STATES.has(record.state) || record.taskID === undefined
          ? record
          : await cancelTask(runID, record.taskID),
      )
    },
    inbox: {
      list(filter) {
        requireActive()
        return inbox.api.list(filter)
      },
      get(id) {
        requireActive()
        return inbox.api.get(id)
      },
      answer: (id, content) => admitted(() => inbox.api.answer(id, content)),
      decline: (id, reason) => admitted(() => inbox.api.decline(id, reason)),
      cancel: (id) => admitted(() => inbox.api.cancel(id)),
    },
    events,
    dispose() {
      if (disposal !== undefined) return disposal
      disposed = true
      disposal = (async () => {
        await Promise.allSettled(inFlight)
        watchers.stop()
        await wiring.dispose()
      })()
      return disposal
    },
  }
  const start = host.start
  const cancel = host.cancel
  host.start = (request) => admitted(() => start(request))
  host.cancel = (runID) => admitted(() => cancel(runID))
  return host
}
