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
import { createLauncher } from './launch.js'
import { mapTaskSnapshot } from './map-task.js'
import { createMemoryRunStore } from './run-store.js'
import { createRunQueue, TERMINAL_STATES, transition } from './transitions.js'
import type {
  FlowHost,
  FlowHostEvents,
  FlowHostParams,
  FlowRunSnapshot,
  InboxItem,
  InboxOutcome,
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
  const wiring = await addDecisionFlow(params.session, {
    key,
    flows: params.flows,
    predictor: params.predictor,
    store: params.taskStore ?? createMemoryTaskStore(),
  })
  const client = params.session.contextHost.getContext(key).client
  const events = new EventEmitter<FlowHostEvents>()
  const queue = createRunQueue()
  const items = new Map<string, { item: InboxItem; status: 'open' | 'settling' | 'settled' }>()
  const lastApplied = new Map<string, number>()
  function emit<Event extends keyof FlowHostEvents>(event: Event, value: FlowHostEvents[Event]) {
    void events.emit(event, value).catch(() => undefined)
  }
  function settle(runID: string, outcome: InboxOutcome) {
    const entry = items.get(`${runID}:approval`)
    if (entry === undefined || entry.status === 'settled') return
    entry.status = 'settled'
    emit('inbox:settled', { item: structuredClone(entry.item), outcome })
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
  async function apply(runID: string, task: DetailedTask): Promise<boolean> {
    return queue.run(runID, async () => {
      const timestamp = Date.parse(task.lastUpdatedAt)
      const result = await transition(store, runID, () => {
        if (timestamp < (lastApplied.get(runID) ?? Number.NEGATIVE_INFINITY)) return undefined
        return mapTaskSnapshot(task)
      })
      if (result.changed) lastApplied.set(runID, timestamp)
      if (result.stateChanged) emit('run:state', runSnapshot(result.record))
      return TERMINAL_STATES.has(result.record.state)
    })
  }
  const watchers = createWatchers({
    client,
    pollMs: params.pollMs ?? 500,
    apply,
    interrupted: async (runID) => {
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
      if (approvalID !== undefined && items.get(approvalID)?.status !== 'open')
        throw new InboxItemNotFoundError(approvalID)
      const claimed = await transition(store, runID, (record) =>
        record.state === 'awaiting_approval' ? { state: 'working' } : undefined,
      )
      if (!claimed.changed) throw new InboxItemNotFoundError(approvalID ?? `${runID}:approval`)
      if (claimed.stateChanged) emit('run:state', runSnapshot(claimed.record))
      if (approvalID !== undefined) settle(runID, 'answered')
      return claimed.record
    })
  }
  async function approval(id: string, outcome: 'declined' | 'cancelled', reason?: string) {
    const runID = items.get(id)?.item.runID
    if (runID === undefined) throw new InboxItemNotFoundError(id)
    await queue.run(runID, async () => {
      if (items.get(id)?.status !== 'open') throw new InboxItemNotFoundError(id)
      const result = await transition(store, runID, () =>
        outcome === 'declined'
          ? { state: 'denied', error: { type: 'FlowDenied', message: reason ?? 'Flow denied' } }
          : { state: 'cancelled' },
      )
      if (!result.changed) throw new InboxItemNotFoundError(id)
      if (result.stateChanged) emit('run:state', runSnapshot(result.record))
      settle(runID, outcome)
    })
  }
  return {
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
        items.set(item.id, { item, status: 'open' })
        emit('inbox:added', structuredClone(item))
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
          settle(runID, 'cancelled')
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
        return [...items.values()]
          .filter(
            ({ item, status }) =>
              status === 'open' && (filter?.runID === undefined || item.runID === filter.runID),
          )
          .map(({ item }) => structuredClone(item))
      },
      get(id) {
        const entry = items.get(id)
        return entry?.status === 'open' ? structuredClone(entry.item) : undefined
      },
      async answer(id) {
        const runID = items.get(id)?.item.runID
        if (runID === undefined) throw new InboxItemNotFoundError(id)
        await launch(await claim(runID, id))
      },
      decline: (id, reason) => approval(id, 'declined', reason),
      cancel: (id) => approval(id, 'cancelled'),
    },
    events,
    async dispose() {
      watchers.stop()
      await wiring.dispose()
    },
  }
}
