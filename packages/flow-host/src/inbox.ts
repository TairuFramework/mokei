import type { ContextClient } from '@mokei/context-client'
import type { DetailedTask, ElicitResult, InputResponse } from '@mokei/context-protocol'
import { isTerminalRunState } from '@mokei/flow-client'
import type { ElicitContentValidator } from '@mokei/host'
import { createElicitContentValidator } from '@mokei/host'
import { getMokeiLogger } from '@mokei/logger'

import { InboxAnswerInvalidError, InboxItemNotFoundError } from './errors.js'
import { isTaskNotFound } from './run-helpers.js'
import type { RunStore } from './run-store.js'
import type { createRunQueue } from './transitions.js'
import type { FlowHost, FlowHostEvents, InboxItem, InboxOutcome } from './types.js'

type Entry = {
  item: InboxItem
  status: 'open' | 'settling' | 'settled'
  taskID?: string
  validate?: ElicitContentValidator
}

export function createInbox(params: {
  withRun<T>(runID: string, work: () => T): T
  client: ContextClient
  store: RunStore
  queue: ReturnType<typeof createRunQueue>
  emit<Event extends keyof FlowHostEvents>(event: Event, value: FlowHostEvents[Event]): void
  approve(runID: string, id: string): Promise<void>
  rejectApproval(id: string, outcome: 'declined' | 'cancelled', reason?: string): Promise<void>
}) {
  const items = new Map<string, Entry>()
  const cancelledURLs = new Map<string, Set<string>>()
  const latestInputKeys = new Map<string, Set<string>>()
  const logger = getMokeiLogger('flow-host')
  function requireOpen(id: string): Entry {
    const entry = items.get(id)
    if (entry?.status !== 'open') throw new InboxItemNotFoundError({ itemID: id })
    return entry
  }
  function settle(id: string, outcome: InboxOutcome) {
    const entry = items.get(id)
    if (entry === undefined || entry.status === 'settled') return
    entry.status = 'settled'
    delete entry.validate
    params.emit('inbox:settled', { item: structuredClone(entry.item), outcome })
  }
  function prune(runID: string) {
    for (const [id, entry] of items) {
      if (entry.item.runID !== runID) continue
      settle(id, 'withdrawn')
      items.delete(id)
    }
    cancelledURLs.delete(runID)
    latestInputKeys.delete(runID)
  }
  function add(item: InboxItem, taskID?: string, validate?: ElicitContentValidator) {
    if (items.has(item.id)) return
    const copy = structuredClone(item)
    items.set(item.id, {
      item: copy,
      status: 'open',
      taskID,
      validate,
    })
    params.emit('inbox:added', structuredClone(copy))
  }
  function reconcile(runID: string, task?: DetailedTask) {
    return params.withRun(runID, () => {
      const requests = task?.status === 'input_required' ? task.inputRequests : {}
      latestInputKeys.set(runID, new Set(Object.keys(requests)))
      for (const [id, entry] of items) {
        if (
          entry.item.runID === runID &&
          entry.item.kind === 'input' &&
          entry.status === 'open' &&
          !Object.hasOwn(requests, entry.item.inputKey)
        ) {
          settle(id, 'withdrawn')
        }
      }
      for (const [inputKey, request] of Object.entries(requests)) {
        if (request.method !== 'elicitation/create' || request.params.mode === 'url') continue
        add(
          {
            id: `${runID}:${inputKey}`,
            runID,
            kind: 'input',
            inputKey,
            message: request.params.message,
            requestedSchema: request.params.requestedSchema,
            createdAt: Date.now(),
          },
          task?.taskId,
          createElicitContentValidator(structuredClone(request.params.requestedSchema)),
        )
      }
    })
  }
  async function cancelURLs(runID: string, task: DetailedTask) {
    return params.withRun(runID, async () => {
      if (task.status !== 'input_required') return
      for (const [inputKey, request] of Object.entries(task.inputRequests)) {
        const id = `${runID}:${inputKey}`
        if (
          request.method !== 'elicitation/create' ||
          request.params.mode !== 'url' ||
          cancelledURLs.get(runID)?.has(id)
        )
          continue
        logger.warn('Cancelling URL elicitation for {runID}', { runID })
        await params.client.tasks.update(task.taskId, { [inputKey]: { action: 'cancel' } })
        await params.queue.run(runID, async () => {
          const record = await params.store.get(runID)
          if (record === undefined || isTerminalRunState(record.state)) return
          const keys = cancelledURLs.get(runID) ?? new Set<string>()
          keys.add(id)
          cancelledURLs.set(runID, keys)
        })
      }
    })
  }
  async function respond(
    id: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, unknown>,
    reason?: string,
  ) {
    const initial = requireOpen(id)
    return params.withRun(initial.item.runID, async () => {
      if (initial.item.kind === 'approval') {
        if (action === 'accept') await params.approve(initial.item.runID, id)
        else
          await params.rejectApproval(id, action === 'decline' ? 'declined' : 'cancelled', reason)
        return
      }
      const runID = initial.item.runID
      const claimed = await params.queue.run(runID, async () => {
        const entry = requireOpen(id)
        if (entry.item.kind !== 'input' || entry.taskID === undefined)
          throw new InboxItemNotFoundError({ itemID: id })
        if (action === 'accept') {
          const issues = entry.validate?.(content) ?? []
          if (issues.length > 0) throw new InboxAnswerInvalidError({ issues })
        }
        const response: InputResponse =
          action === 'accept' ? { action, content: content as ElicitResult['content'] } : { action }
        entry.status = 'settling'
        return { entry, taskID: entry.taskID, inputKey: entry.item.inputKey, response }
      })
      try {
        await params.client.tasks.update(claimed.taskID, { [claimed.inputKey]: claimed.response })
      } catch (error) {
        await params.queue.run(runID, async () => {
          if (
            isTaskNotFound(error) ||
            (error !== null &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === -32602)
          ) {
            settle(id, 'withdrawn')
            throw new InboxItemNotFoundError({ itemID: id })
          }
          const record = await params.store.get(runID)
          if (
            record === undefined ||
            isTerminalRunState(record.state) ||
            !latestInputKeys.get(runID)?.has(claimed.inputKey)
          ) {
            settle(id, 'withdrawn')
          } else {
            claimed.entry.status = 'open'
          }
        })
        throw error
      }
      await params.queue.run(runID, async () => {
        settle(
          id,
          action === 'accept' ? 'answered' : action === 'decline' ? 'declined' : 'cancelled',
        )
      })
    })
  }
  const api: FlowHost['inbox'] = {
    list(filter) {
      return [...items.values()]
        .filter(({ item, status }) => {
          return status === 'open' && (filter?.runID === undefined || item.runID === filter.runID)
        })
        .map(({ item }) => structuredClone(item))
    },
    get(id) {
      const entry = items.get(id)
      if (entry === undefined) throw new InboxItemNotFoundError({ itemID: id })
      return entry.status === 'open' ? structuredClone(entry.item) : undefined
    },
    answer: (id, content) => respond(id, 'accept', content),
    decline: (id, reason) => respond(id, 'decline', undefined, reason),
    cancel: (id) => respond(id, 'cancel'),
  }
  return { api, add, requireOpen, settle, reconcile, cancelURLs, prune }
}
