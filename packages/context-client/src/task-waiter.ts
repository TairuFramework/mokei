import type {
  CallToolResult,
  DetailedTask,
  InputRequest,
  InputResponse,
  TasksGetResult,
} from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { sleep } from '@sozai/async'

import {
  InputRequiredNotSupportedError,
  TaskCancelledError,
  TaskInputUnavailableError,
} from './errors.js'
import type { ListenHandle, OpenListen } from './subscriptions.js'

const TASK_LISTEN_ACK_TIMEOUT_MS = 3_000

export type WaitForTaskParams = {
  taskID: string
  signal?: AbortSignal
  onStatus?: (status: DetailedTask) => void
  toolName?: string
  cancelOnAbort?: boolean
}

export type TaskWaiterParams = {
  request: (
    method: 'tasks/get' | 'tasks/update' | 'tasks/cancel',
    params: { taskId: string; inputResponses?: Record<string, InputResponse> },
  ) => Promise<unknown>
  openListen: OpenListen
  fulfil: (key: string, request: InputRequest, signal: AbortSignal) => Promise<InputResponse>
  validate: (result: CallToolResult, toolName: string) => CallToolResult
  delay?: (ms: number, signal: AbortSignal) => Promise<void>
}

type TaskEntry = {
  count: number
  handle?: ListenHandle
  acknowledged: Promise<boolean>
  resolveAcknowledged: (accepted: boolean) => void
  acknowledgementTimer?: ReturnType<typeof setTimeout>
  active: boolean
  latest?: DetailedTask
  version: number
  listeners: Set<() => void>
  statusListeners: Set<(status: DetailedTask) => void>
  inputs: Record<string, InputRequest>
  dispatched: Set<string>
  inputError?: Error
  controller: AbortController
}

export class TaskWaiter {
  #params: TaskWaiterParams
  #entries = new Map<string, TaskEntry>()

  constructor(params: TaskWaiterParams) {
    this.#params = params
  }

  async wait(params: WaitForTaskParams): Promise<CallToolResult> {
    const entry = this.#acquire(params.taskID)
    let statusError: unknown
    const notifyStatus = (status: DetailedTask) => {
      try {
        params.onStatus?.(status)
      } catch (error) {
        statusError = error
        this.#wake(entry)
      }
    }
    if (params.onStatus != null) entry.statusListeners.add(notifyStatus)
    let seen = 0
    try {
      const accepted = await this.#abortable(entry.acknowledged, params.signal)
      seen = entry.version
      let snapshot: DetailedTask = await this.#get(params.taskID, params.signal)
      let fromGet = true
      for (;;) {
        if (snapshot.taskId !== params.taskID) {
          throw new Error(`Unexpected taskId ${snapshot.taskId}`)
        }
        if (
          fromGet &&
          (entry.version === seen ||
            entry.latest == null ||
            snapshot.lastUpdatedAt > entry.latest.lastUpdatedAt)
        ) {
          this.#observe(entry, snapshot)
        }
        snapshot = entry.latest ?? snapshot
        seen = entry.version
        if (fromGet) notifyStatus(snapshot)
        if (statusError != null) throw statusError
        if (snapshot.status === 'completed') {
          return params.toolName == null
            ? snapshot.result
            : this.#params.validate(snapshot.result, params.toolName)
        }
        if (snapshot.status === 'failed') {
          throw new RPCError(snapshot.error)
        }
        if (snapshot.status === 'cancelled') {
          throw new TaskCancelledError({ taskID: params.taskID })
        }
        if (entry.inputError != null) {
          throw entry.inputError
        }
        if (snapshot.status === 'input_required') {
          this.#dispatchInputs(entry, params.taskID, snapshot.inputRequests)
        }
        if (entry.inputError != null) {
          throw entry.inputError
        }
        if (accepted && entry.active) {
          await this.#waitForChange(entry, seen, params.signal)
          seen = entry.version
          snapshot = entry.latest ?? (await this.#get(params.taskID, params.signal))
          fromGet = entry.latest == null
        } else {
          await (this.#params.delay ?? sleep)(
            Math.max(250, snapshot.pollIntervalMs ?? 1000),
            params.signal ?? entry.controller.signal,
          )
          seen = entry.version
          snapshot = await this.#get(params.taskID, params.signal)
          fromGet = true
        }
      }
    } catch (error) {
      if (params.signal?.aborted && params.cancelOnAbort) {
        try {
          await this.#params.request('tasks/cancel', { taskId: params.taskID })
        } catch {
          // Preserve the caller's abort reason.
        }
        throw params.signal.reason
      }
      if (error instanceof TaskInputUnavailableError && params.cancelOnAbort) {
        try {
          await this.#params.request('tasks/cancel', { taskId: params.taskID })
        } catch {
          // Preserve the unavailable-input error.
        }
      }
      throw error
    } finally {
      if (params.onStatus != null) entry.statusListeners.delete(notifyStatus)
      this.#release(params.taskID, entry)
    }
  }

  #acquire(taskID: string): TaskEntry {
    const existing = this.#entries.get(taskID)
    if (existing != null) {
      existing.count += 1
      return existing
    }
    let resolveAcknowledged: (accepted: boolean) => void = () => {}
    const acknowledged = new Promise<boolean>((resolve) => {
      resolveAcknowledged = resolve
    })
    const entry: TaskEntry = {
      count: 1,
      acknowledged,
      resolveAcknowledged,
      active: false,
      version: 0,
      listeners: new Set(),
      statusListeners: new Set(),
      inputs: {},
      dispatched: new Set(),
      controller: new AbortController(),
    }
    let acknowledgementPending = true
    const finishAcknowledgement = (accepted: boolean) => {
      if (!acknowledgementPending) return
      acknowledgementPending = false
      clearTimeout(entry.acknowledgementTimer)
      entry.active = accepted
      entry.resolveAcknowledged(accepted)
    }
    entry.acknowledgementTimer = setTimeout(() => {
      finishAcknowledgement(false)
      const handle = entry.handle
      entry.handle = undefined
      handle?.abort()
    }, TASK_LISTEN_ACK_TIMEOUT_MS)
    this.#entries.set(taskID, entry)
    try {
      entry.handle = this.#params.openListen(
        { taskIds: [taskID] },
        {
          onNotification: (notification) => {
            if (
              (notification as { method?: string }).method ===
              'notifications/subscriptions/acknowledged'
            ) {
              const acknowledged = notification as unknown as {
                params?: { notifications?: { taskIds?: Array<string> } }
              }
              const accepted =
                acknowledged.params?.notifications?.taskIds?.includes(taskID) ?? false
              finishAcknowledgement(accepted)
              return
            }
            if (
              notification.method !== 'notifications/tasks' ||
              notification.params.taskId !== taskID
            ) {
              return
            }
            this.#observe(entry, notification.params)
            for (const listener of entry.statusListeners) listener(notification.params)
          },
          onSettle: () => {
            entry.active = false
            finishAcknowledgement(false)
            this.#wake(entry)
          },
        },
      )
      entry.handle.exchange.catch(() => {})
    } catch {
      finishAcknowledgement(false)
    }
    return entry
  }

  #release(taskID: string, entry: TaskEntry): void {
    entry.count -= 1
    if (entry.count > 0) return
    this.#entries.delete(taskID)
    clearTimeout(entry.acknowledgementTimer)
    entry.controller.abort()
    entry.handle?.abort()
  }

  #observe(entry: TaskEntry, snapshot: DetailedTask): void {
    if (entry.latest != null) {
      if (snapshot.lastUpdatedAt < entry.latest.lastUpdatedAt) return
      if (
        snapshot.lastUpdatedAt === entry.latest.lastUpdatedAt &&
        (entry.latest.status === 'completed' ||
          entry.latest.status === 'failed' ||
          entry.latest.status === 'cancelled')
      )
        return
    }
    entry.latest = snapshot
    entry.inputs = snapshot.status === 'input_required' ? snapshot.inputRequests : {}
    this.#wake(entry)
  }

  #wake(entry: TaskEntry): void {
    entry.version += 1
    for (const listener of entry.listeners) listener()
  }

  async #waitForChange(entry: TaskEntry, seen: number, signal?: AbortSignal): Promise<void> {
    if (entry.version !== seen || !entry.active || entry.inputError != null) return
    let wake: () => void = () => {}
    const changed = new Promise<void>((resolve) => {
      wake = resolve
      entry.listeners.add(wake)
      if (entry.version !== seen || !entry.active) wake()
    })
    try {
      await this.#abortable(changed, signal)
    } finally {
      entry.listeners.delete(wake)
    }
  }

  async #abortable<Value>(promise: Promise<Value>, signal?: AbortSignal): Promise<Value> {
    if (signal == null) return promise
    if (signal.aborted) throw signal.reason
    return await new Promise<Value>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  async #get(taskID: string, signal?: AbortSignal): Promise<TasksGetResult> {
    return await this.#abortable(
      this.#params.request('tasks/get', { taskId: taskID }) as Promise<TasksGetResult>,
      signal,
    )
  }

  #dispatchInputs(entry: TaskEntry, taskID: string, requests: Record<string, InputRequest>): void {
    for (const [key, request] of Object.entries(requests)) {
      if (entry.dispatched.has(key)) continue
      entry.dispatched.add(key)
      void this.#params
        .fulfil(key, request, entry.controller.signal)
        .then(async (response) => {
          if (!Object.hasOwn(entry.inputs, key)) return
          try {
            await this.#params.request('tasks/update', {
              taskId: taskID,
              inputResponses: { [key]: response },
            })
          } catch (error) {
            if (
              !(error instanceof RPCError) ||
              error.code !== -32602 ||
              typeof error.data !== 'object' ||
              error.data === null ||
              !('key' in error.data) ||
              error.data.key !== key
            )
              throw error
            const snapshot = await this.#get(taskID, entry.controller.signal)
            if (snapshot.status === 'input_required' && Object.hasOwn(snapshot.inputRequests, key))
              throw error
            this.#observe(entry, snapshot)
          }
        })
        .catch((error: unknown) => {
          entry.inputError =
            error instanceof InputRequiredNotSupportedError
              ? new TaskInputUnavailableError({ taskID, key, cause: error })
              : error instanceof Error
                ? error
                : new Error(String(error))
          this.#wake(entry)
        })
    }
  }
}
