import type { DetailedTask } from '@mokei/context-protocol'
import type { JSONValue } from '@mokei/context-server'
import { createMemoryTaskStore } from '@mokei/context-server'
import { addDecisionFlow, flowToolName } from '@mokei/decision-flow-server'
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
import { approvalItem, equalValue, interruptedError, isTaskNotFound } from './run-helpers.js'
import { createMemoryRunStore } from './run-store.js'
import { createRunTracing } from './tracing.js'
import { createRunQueue, TERMINAL_STATES, transition } from './transitions.js'
import type {
  FlowHost,
  FlowHostEvents,
  FlowHostParams,
  FlowRunSnapshot,
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

/**
 * Recovery events fire during creation. Pass listeners to receive them, or
 * reconcile list() and inbox.list() after creation resolves, then rely on events.
 * Creation awaits the first applied snapshot of every recovered task-backed run.
 */
export async function createFlowHost(params: FlowHostParams): Promise<FlowHost> {
  if (!params.session.contextHost.elicitationEnabled)
    throw new Error('Flow host requires elicitation')
  const key = params.key ?? 'flow'
  const store = params.runStore ?? createMemoryRunStore()
  const taskStore = params.taskStore ?? createMemoryTaskStore()
  const wiring = await addDecisionFlow(params.session, {
    key,
    flows: params.flows,
    predictor: params.predictor,
    store: taskStore,
    taskTTLMs: params.taskTTLMs === undefined ? null : params.taskTTLMs,
  })
  const client = params.session.contextHost.getContext(key).client
  const events = new EventEmitter<FlowHostEvents>()
  function listen<Event extends keyof FlowHostEvents>(event: Event) {
    const handler = params.listeners?.[event]
    if (handler !== undefined) events.on(event, handler)
  }
  listen('run:state')
  listen('inbox:added')
  listen('inbox:settled')
  const queue = createRunQueue()
  const tracing = createRunTracing()
  const lastApplied = new Map<string, number>()
  function emit<Event extends keyof FlowHostEvents>(event: Event, value: FlowHostEvents[Event]) {
    const runID =
      event === 'inbox:settled'
        ? (value as FlowHostEvents['inbox:settled']).item.runID
        : (value as FlowRunSnapshot | FlowHostEvents['inbox:added']).runID
    // Capture context before terminal state cleanup removes the open span.
    tracing.withRun(runID, () => {
      if (event === 'run:state') {
        const snapshot = value as FlowRunSnapshot
        tracing.state(snapshot.runID, snapshot.state)
      }
      void events.emit(event, value).catch(() => undefined)
    })
  }
  async function change(
    runID: string,
    compute: (record: RunRecord) => Partial<RunRecord> | undefined,
  ) {
    return tracing.withRun(runID, () => {
      return queue.run(runID, async () => {
        const result = await transition(store, runID, compute)
        if (result.stateChanged) emit('run:state', runSnapshot(result.record))
        terminal(result.record)
        return result.record
      })
    })
  }
  const inbox = createInbox({
    withRun: tracing.withRun,
    client,
    store,
    queue,
    emit,
    approve: async (runID, id) => {
      await launch(await claim(runID, id))
    },
    rejectApproval: approval,
  })
  function terminal(record: RunRecord) {
    if (!TERMINAL_STATES.has(record.state)) return
    inbox.prune(record.runID)
    lastApplied.delete(record.runID)
  }
  async function apply(
    runID: string,
    task: DetailedTask,
    reconciled?: () => void,
  ): Promise<boolean> {
    return tracing.withRun(runID, async () => {
      const applied = await queue.run(runID, async () => {
        const timestamp = Date.parse(task.lastUpdatedAt)
        let accepted = false
        const unsupported =
          task.status === 'input_required'
            ? Object.values(task.inputRequests).find(
                (request) => request.method !== 'elicitation/create',
              )?.method
            : undefined
        const result = await transition(store, runID, (current) => {
          if (timestamp < (lastApplied.get(runID) ?? Number.NEGATIVE_INFINITY)) return undefined
          accepted = true
          const mapped =
            unsupported === undefined
              ? mapTaskSnapshot(task)
              : {
                  state: 'failed' as const,
                  error: { type: 'UnsupportedInput', message: unsupported },
                }
          return mapped.state === current.state &&
            equalValue(mapped.result, current.result) &&
            equalValue(mapped.error, current.error)
            ? undefined
            : mapped
        })
        if (accepted) lastApplied.set(runID, timestamp)
        if (result.stateChanged) emit('run:state', runSnapshot(result.record))
        const terminalState = TERMINAL_STATES.has(result.record.state)
        if (accepted && !terminalState) inbox.reconcile(runID, task)
        terminal(result.record)
        return {
          terminal: terminalState,
          accepted,
          cancelUnsupported:
            result.record.error?.type === 'UnsupportedInput' &&
            (task.status === 'working' || task.status === 'input_required'),
        }
      })
      // Readiness covers committed state and inbox, before retryable cancellation effects.
      reconciled?.()
      // Network calls stay outside the run queue so pending responses cannot block transitions.
      if (applied.cancelUnsupported) {
        await client.tasks.cancel(task.taskId)
      } else if (applied.accepted && !applied.terminal) {
        await inbox.cancelURLs(runID, task)
      }
      return applied.terminal
    })
  }
  const watchers = createWatchers({
    withRun: tracing.withRun,
    client,
    pollMs: params.pollMs ?? 500,
    apply,
    interrupted: async (runID) => {
      await change(runID, () => ({ state: 'failed', error: interruptedError() }))
    },
  })
  async function cancelTask(runID: string, taskID: string): Promise<RunRecord> {
    return tracing.withRun(runID, async () => {
      try {
        await client.tasks.cancel(taskID)
        const task = await client.tasks.get(taskID)
        await apply(runID, task)
      } catch (error) {
        if (!isTaskNotFound(error)) throw error
        return change(runID, () => ({ state: 'cancelled' }))
      }
      const record = await store.get(runID)
      if (record === undefined) throw new RunNotFoundError({ runID })
      if (!TERMINAL_STATES.has(record.state)) watchers.watch(runID, taskID)
      return record
    })
  }
  const launch = createLauncher({
    client,
    wiring,
    change,
    cancelTask,
    watch: watchers.watch,
    tracing,
  })
  async function claim(runID: string, approvalID?: string): Promise<RunRecord> {
    return tracing.withRun(runID, () => {
      return queue.run(runID, async () => {
        if (approvalID !== undefined) inbox.requireOpen(approvalID)
        const claimed = await transition(store, runID, (record) =>
          record.state === 'awaiting_approval' ? { state: 'working' } : undefined,
        )
        if (!claimed.changed && approvalID !== undefined)
          throw new InboxItemNotFoundError({ itemID: approvalID })
        if (claimed.stateChanged) emit('run:state', runSnapshot(claimed.record))
        if (approvalID !== undefined) inbox.settle(approvalID, 'answered')
        return claimed.record
      })
    })
  }
  async function launchAllowed(runID: string): Promise<RunRecord> {
    const claimed = await claim(runID)
    return TERMINAL_STATES.has(claimed.state) ? claimed : launch(claimed)
  }
  async function approval(id: string, outcome: 'declined' | 'cancelled', reason?: string) {
    const runID = inbox.requireOpen(id).item.runID
    await tracing.withRun(runID, () => {
      return queue.run(runID, async () => {
        inbox.requireOpen(id)
        const result = await transition(store, runID, () =>
          outcome === 'declined'
            ? { state: 'denied', error: { type: 'FlowDenied', message: reason ?? 'Flow denied' } }
            : { state: 'cancelled' },
        )
        if (!result.changed) throw new InboxItemNotFoundError({ itemID: id })
        if (result.stateChanged) emit('run:state', runSnapshot(result.record))
        inbox.settle(id, outcome)
        terminal(result.record)
      })
    })
  }
  try {
    await recoverRuns({
      withRun: tracing.withRun,
      store,
      taskStore,
      change,
      addApproval: inbox.add,
      allow: params.approval?.allow ?? [],
      launchAllowed,
      resume: tracing.resume,
      watch: watchers.watch,
      cancelTask,
    })
  } catch (error) {
    await watchers.stop().catch(() => undefined)
    tracing.dispose()
    await wiring.dispose().catch(() => undefined)
    throw error
  }
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
    flows: wiring.flows,
    check: wiring.check,
    async start(request) {
      const flow = 'flow' in request ? wiring.lookupFlow(request.flow) : undefined
      if ('flow' in request && flow === undefined)
        throw new FlowNotFoundError({ flowID: request.flow })
      const resolved =
        'flow' in request
          ? { toolName: flowToolName(request.flow), arguments: request.input ?? {} }
          : {
              toolName: 'run_flow',
              arguments: {
                definition: request.definition as unknown as JSONValue,
                ...(request.input !== undefined ? { input: request.input } : {}),
              },
            }
      const storedRequest = structuredClone(resolved)
      const authorized = await wiring.authorize(storedRequest)
      if (!authorized.ok) throw new FlowCheckError({ issues: authorized.issues })
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
      Object.assign(record, tracing.start(record))
      return tracing.withRun(record.runID, async () => {
        const allowed = isAllowed(authorized.plan, params.approval?.allow ?? [])
        let current: RunRecord
        try {
          current = await queue.run(record.runID, async () => {
            await store.create(record)
            const current = await store.get(record.runID)
            if (current === undefined) throw new RunNotFoundError({ runID: record.runID })
            if (allowed) return current
            emit('run:state', runSnapshot(current))
            if (current.state !== 'awaiting_approval') return current
            inbox.add(approvalItem(current))
            return current
          })
        } catch (error) {
          tracing.end(record.runID)
          throw error
        }
        if (allowed) {
          return runSnapshot(await launchAllowed(current.runID))
        }
        return runSnapshot(current)
      })
    },
    async get(runID) {
      const record = await store.get(runID)
      return record === undefined ? undefined : runSnapshot(record)
    },
    async list(filter) {
      return (await store.list(filter ?? {})).map(runSnapshot)
    },
    async cancel(runID) {
      return tracing.withRun(runID, async () => {
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
          terminal(result.record)
          return result.record
        })
        return runSnapshot(
          TERMINAL_STATES.has(record.state) || record.taskID === undefined
            ? record
            : await cancelTask(runID, record.taskID),
        )
      })
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
        await watchers.stop()
        tracing.dispose()
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
