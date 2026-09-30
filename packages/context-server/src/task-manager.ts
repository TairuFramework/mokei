import {
  type CallToolResult,
  type ClientCapabilities,
  type CreateTaskResult,
  type DetailedTask,
  INPUT_REQUEST_CAPABILITIES,
  INVALID_PARAMS,
  type InputRequest,
  type InputResponse,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
} from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { sleep } from '@sozai/async'
import { EventEmitter, type EventsSource } from '@sozai/event'

import { missingInputCapabilities } from './mrtr.js'
import {
  createMemoryTaskStore,
  type InputRecord,
  type JSONValue,
  type TaskOwner,
  type TaskRecord,
  type TaskStore,
  TaskStoreConflictError,
} from './task-store.js'
import { settleToolOutcome } from './tool-outcome.js'
import {
  type GenericToolDefinition,
  MissingRequiredClientCapabilityError,
  type ToolDefinitions,
} from './types.js'

export type TaskWork = (handle: TaskHandle) => CallToolResult | Promise<CallToolResult>
export type TaskHandle = {
  taskID: string
  signal: AbortSignal
  requestMeta: Record<string, JSONValue>
  setStatus(message: string): Promise<void>
  /**
   * Asks the client for input and resolves with its responses. Keys are unique per task: an
   * identical request (same keys, deep-equal contents) under already issued keys re-attaches to
   * the open request or replays its settled outcome, the stored answer or an
   * `InputRequestWithdrawnError` for a withdrawal. A changed request under an issued key throws
   * `TaskInputKeyReusedError`. Aborting `options.signal` withdraws the open request and rejects
   * with `InputRequestWithdrawnError`.
   */
  requestInput(
    requests: Record<string, InputRequest>,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, InputResponse>>
  /**
   * Waits on the task's open input request, as `requestInput` with that request's contents: it
   * resolves with the answer, and aborting `options.signal` withdraws the request and rejects with
   * `InputRequestWithdrawnError`. Throws when no input is outstanding.
   */
  awaitInput(options?: { signal?: AbortSignal }): Promise<Record<string, InputResponse>>
  checkpoint(resumeData: JSONValue): Promise<void>
  cancel(reason?: string): Promise<boolean>
}
export class TaskInputKeyReusedError extends Error {
  constructor(key: string) {
    super(`Input key already issued: ${key}`)
    this.name = 'TaskInputKeyReusedError'
  }
}
export class InputRequestWithdrawnError extends Error {
  #taskID: string
  #id: number

  constructor(params: { taskID: string; id: number }) {
    super(`Input request ${params.id} for task ${params.taskID} was withdrawn`)
    this.name = 'InputRequestWithdrawnError'
    this.#taskID = params.taskID
    this.#id = params.id
  }

  get taskID(): string {
    return this.#taskID
  }

  get id(): number {
    return this.#id
  }
}
export type TaskResume = (work: TaskWork) => Promise<void>
export type TaskContext = {
  run(work: TaskWork, options?: { resumeData?: JSONValue }): Promise<CreateTaskResult>
}
export type TaskManagerParams = {
  store?: TaskStore
  /** Task lifetime in milliseconds. Defaults to 3,600,000. */
  ttlMs?: number
  /** Suggested client poll interval in milliseconds. Defaults to 1,000. */
  pollIntervalMs?: number
  recover?: (record: TaskRecord, resume: TaskResume) => Promise<void> | void
  now?: () => number
}
export type TaskManager = {
  events: EventsSource<{ taskStatus: DetailedTask; taskError: { taskID?: string; error: unknown } }>
  create(params: {
    toolName: string
    tool: GenericToolDefinition
    clientCapabilities: ClientCapabilities
    owner?: TaskOwner
    work: TaskWork
    resumeData?: JSONValue
    requestMeta?: Record<string, JSONValue>
  }): Promise<CreateTaskResult>
  get(taskID: string, owner?: TaskOwner): Promise<DetailedTask>
  update(taskID: string, responses: Record<string, InputResponse>, owner?: TaskOwner): Promise<void>
  cancel(taskID: string, owner?: TaskOwner): Promise<void>
  canAccess(taskID: string, owner?: TaskOwner): Promise<boolean>
  recover(tools: ToolDefinitions): Promise<void>
  dispose(): Promise<void>
}

const ACTIVE = ['working', 'input_required'] as const
const ALL_STATUSES = ['working', 'input_required', 'completed', 'failed', 'cancelled'] as const
const INTERRUPTED = { code: -32603, message: 'Task interrupted by server restart' }

function isTerminal(record: TaskRecord): boolean {
  return (
    record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled'
  )
}

/** The latest input request, when it is open: status and outcome change in the same write. */
function openInput(record: TaskRecord): InputRecord | undefined {
  const latest = record.inputs.at(-1)
  return record.status === 'input_required' && latest?.outcome === undefined ? latest : undefined
}

function settleLatest(record: TaskRecord, entry: InputRecord): Array<InputRecord> {
  return [...record.inputs.slice(0, -1), entry]
}

function detailed(record: TaskRecord): DetailedTask {
  const base = {
    taskId: record.taskID,
    status: record.status,
    ...(record.statusMessage !== undefined && { statusMessage: record.statusMessage }),
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
    ttlMs: record.ttlMs,
    ...(record.pollIntervalMs !== undefined && { pollIntervalMs: record.pollIntervalMs }),
  }
  if (record.status === 'input_required') {
    // Never empty for an open request: the final answer closes it in the same write.
    const open = openInput(record)
    const inputRequests: Record<string, InputRequest> = {}
    for (const [key, request] of Object.entries(open?.requests ?? {}))
      if (!Object.hasOwn(open?.responses ?? {}, key)) inputRequests[key] = request
    return { ...base, status: 'input_required', inputRequests }
  }
  if (record.status === 'completed')
    return {
      ...base,
      status: 'completed',
      result: record.result as NonNullable<TaskRecord['result']>,
    }
  if (record.status === 'failed')
    return { ...base, status: 'failed', error: record.error as NonNullable<TaskRecord['error']> }
  if (record.status === 'cancelled') return { ...base, status: 'cancelled' }
  return { ...base, status: 'working' }
}

function taskNotFound(): RPCError {
  return new RPCError({ code: INVALID_PARAMS, message: 'Task not found' })
}

function matchesOwner(saved?: TaskOwner, caller?: TaskOwner): boolean {
  if (saved === undefined || caller === undefined) return saved === caller
  return (
    saved.issuer === caller.issuer &&
    saved.subject === caller.subject &&
    saved.scopes.every((scope) => caller.scopes.includes(scope))
  )
}

function responseMatches(request: InputRequest, response: InputResponse): boolean {
  if (request.method === 'roots/list') return 'roots' in response
  if (request.method === 'elicitation/create') return 'action' in response
  return 'model' in response && 'content' in response
}

function equalJSON(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJSON(value, right[index]))
    )
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) => Object.hasOwn(rightRecord, key) && equalJSON(leftRecord[key], rightRecord[key]),
    )
  )
}

/** Receives each committed record of a task, possibly out of order; `undefined` means deleted. */
type RecordListener = (record: TaskRecord | undefined) => void

/** Retry backoff for withdrawal writes and outcome reads. */
const WITHDRAW_BACKOFF_MS = { initial: 10, max: 1_000 }

class ManagedTasks implements TaskManager {
  #store: TaskStore
  #ttlMs: number
  #pollIntervalMs: number
  #now: () => number
  #recoverCallback?: TaskManagerParams['recover']
  #ready: Promise<void>
  #hidden = new Set<string>()
  #recovering = new Set<string>()
  #controllers = new Map<string, AbortController>()
  #listeners = new Map<string, Set<RecordListener>>()
  #events = new EventEmitter<{
    taskStatus: DetailedTask
    taskError: { taskID?: string; error: unknown }
  }>()
  #timer: ReturnType<typeof setInterval>
  #disposed = false
  /** Aborted on disposal, so backoff sleeps end instead of holding the event loop. */
  #disposal = new AbortController()

  constructor(params: TaskManagerParams) {
    this.#store = params.store ?? createMemoryTaskStore()
    this.#ttlMs = params.ttlMs ?? 3_600_000
    this.#pollIntervalMs = params.pollIntervalMs ?? 1_000
    this.#now = params.now ?? Date.now
    this.#recoverCallback = params.recover
    this.#ready = this.#initialise()
    this.#timer = setInterval(
      () => {
        void this.#sweep().catch((error) => {
          // A failed scan cannot identify an individual task.
          this.#events.fire('taskError', { error })
        })
      },
      Math.max(1, Math.min(this.#ttlMs, 1_000)),
    )
    this.#timer.unref?.()
  }

  get events(): EventsSource<{
    taskStatus: DetailedTask
    taskError: { taskID?: string; error: unknown }
  }> {
    return this.#events
  }

  async #initialise(): Promise<void> {
    const records = await this.#store.list({ status: [...ACTIVE] })
    for (const record of records) this.#hidden.add(record.taskID)
    if (this.#recoverCallback === undefined) {
      for (const record of records) await this.#failInterrupted(record.taskID)
    }
  }

  async #failInterrupted(taskID: string): Promise<void> {
    await this.#mutate(taskID, (record) =>
      isTerminal(record) ? undefined : { status: 'failed', error: INTERRUPTED },
    )
    this.#hidden.delete(taskID)
  }

  /**
   * Applies `change` as one conditional write, re-reading and rerunning it on a revision
   * conflict. `committed` runs after the write commits and before any observer sees it.
   */
  async #mutate(
    taskID: string,
    change: (record: TaskRecord) => Partial<TaskRecord> | undefined,
    committed?: (record: TaskRecord) => void,
  ): Promise<TaskRecord | undefined> {
    while (true) {
      const record = await this.#store.get(taskID)
      if (record === undefined) return undefined
      const patch = change(record)
      if (patch === undefined) return record
      // Strictly increasing per task, so distinct revisions never share a timestamp.
      const lastUpdatedAt = Math.max(this.#now(), Date.parse(record.lastUpdatedAt) + 1)
      let updated: TaskRecord
      try {
        updated = await this.#store.update(
          taskID,
          { ...patch, lastUpdatedAt: new Date(lastUpdatedAt).toISOString() },
          { revision: record.revision },
        )
      } catch (error) {
        if ((await this.#store.get(taskID)) === undefined) return undefined
        if (!(error instanceof TaskStoreConflictError)) throw error
        continue
      }
      committed?.(updated)
      this.#events.fire('taskStatus', detailed(updated))
      this.#notify(taskID, updated)
      return updated
    }
  }

  #listen(taskID: string, listener: RecordListener): () => void {
    let listeners = this.#listeners.get(taskID)
    if (listeners === undefined) {
      listeners = new Set()
      this.#listeners.set(taskID, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && this.#listeners.get(taskID) === listeners)
        this.#listeners.delete(taskID)
    }
  }

  #notify(taskID: string, record: TaskRecord | undefined): void {
    for (const listener of [...(this.#listeners.get(taskID) ?? [])]) listener(record)
  }

  #abort(taskID: string, reason: unknown): void {
    this.#controllers.get(taskID)?.abort(reason)
    this.#controllers.delete(taskID)
  }

  async #expire(record: TaskRecord): Promise<boolean> {
    if (record.ttlMs === null || this.#now() < Date.parse(record.createdAt) + record.ttlMs)
      return false
    await this.#store.delete(record.taskID)
    this.#hidden.delete(record.taskID)
    this.#notify(record.taskID, undefined)
    this.#abort(record.taskID, new Error('Task expired'))
    return true
  }

  async #visible(taskID: string, owner?: TaskOwner): Promise<TaskRecord> {
    await this.#ready
    const record = await this.#store.get(taskID)
    if (record === undefined) throw taskNotFound()
    if (await this.#expire(record)) throw taskNotFound()
    if (this.#hidden.has(taskID) || !matchesOwner(record.owner, owner)) throw taskNotFound()
    return record
  }

  async #sweep(): Promise<void> {
    await this.#ready
    if (this.#disposed) return
    for (const record of await this.#store.list({ status: [...ALL_STATUSES] })) {
      try {
        await this.#expire(record)
      } catch (error) {
        this.#events.fire('taskError', { taskID: record.taskID, error })
      }
    }
  }

  async create(params: {
    toolName: string
    tool: GenericToolDefinition
    clientCapabilities: ClientCapabilities
    owner?: TaskOwner
    work: TaskWork
    resumeData?: JSONValue
    requestMeta?: Record<string, JSONValue>
  }): Promise<CreateTaskResult> {
    await this.#ready
    if (this.#disposed) throw new Error('Task manager disposed')
    const createdAt = new Date(this.#now()).toISOString()
    const record: TaskRecord = {
      taskID: crypto.randomUUID(),
      revision: 0,
      status: 'working',
      createdAt,
      lastUpdatedAt: createdAt,
      ttlMs: this.#ttlMs,
      pollIntervalMs: this.#pollIntervalMs,
      toolName: params.toolName,
      clientCapabilities: params.clientCapabilities,
      ...(params.requestMeta !== undefined && { requestMeta: params.requestMeta }),
      inputs: [],
      ...(params.owner !== undefined && { owner: params.owner }),
      ...(params.resumeData !== undefined && { resumeData: params.resumeData }),
    }
    await this.#store.create(record)
    this.#events.fire('taskStatus', detailed(record))
    this.#attach(record.taskID, params.tool, params.work, record.requestMeta)
    return { ...detailed(record), resultType: 'task' }
  }

  #attach(
    taskID: string,
    tool: GenericToolDefinition,
    work: TaskWork,
    requestMeta?: Record<string, JSONValue>,
  ): void {
    const controller = new AbortController()
    this.#controllers.set(taskID, controller)
    const handle: TaskHandle = {
      taskID,
      signal: controller.signal,
      requestMeta: requestMeta ?? {},
      setStatus: async (message) => {
        await this.#activeMutation(taskID, controller, () => ({ statusMessage: message }))
      },
      checkpoint: async (resumeData) => {
        await this.#activeMutation(taskID, controller, () => ({ resumeData }))
      },
      requestInput: (requests, options) =>
        this.#requestInput(taskID, controller, requests, options),
      awaitInput: (options) => this.#awaitInput(taskID, controller, options),
      cancel: (reason) => this.#cancelFromHandle(taskID, controller, reason),
    }
    void (async () => {
      let outcome: { result: CallToolResult } | { error: unknown }
      try {
        outcome = { result: await work(handle) }
      } catch (error) {
        outcome = { error }
      }
      if (controller.signal.aborted || this.#disposed) return
      for (let attempt = 0; attempt <= 3; attempt++) {
        if (controller.signal.aborted || this.#disposed) return
        try {
          const settled = settleToolOutcome(tool, outcome)
          await this.#mutate(taskID, (record) =>
            isTerminal(record)
              ? undefined
              : 'result' in settled
                ? { status: 'completed', result: { ...settled.result, resultType: 'complete' } }
                : { status: 'failed', error: settled.error },
          )
          return
        } catch (error) {
          try {
            const latest = await this.#store.get(taskID)
            if (latest === undefined || isTerminal(latest)) return
          } catch {
            // Report the original settlement failure after the final attempt.
          }
          if (attempt === 3) this.#events.fire('taskError', { taskID, error })
        }
      }
    })()
      .catch((error) => this.#events.fire('taskError', { taskID, error }))
      .finally(() => {
        if (this.#controllers.get(taskID) === controller) this.#controllers.delete(taskID)
      })
  }

  async #cancelFromHandle(
    taskID: string,
    controller: AbortController,
    reason?: string,
  ): Promise<boolean> {
    if (controller.signal.aborted || this.#disposed) return false
    let won = false
    await this.#mutate(
      taskID,
      (record) =>
        isTerminal(record) || controller.signal.aborted || this.#disposed
          ? undefined
          : { status: 'cancelled' },
      () => {
        // Abort before observers see the cancelled record, so waiters reject with this reason.
        won = true
        this.#abort(taskID, new Error(reason ?? 'Task cancelled'))
      },
    )
    return won
  }

  async #activeMutation(
    taskID: string,
    controller: AbortController,
    change: (record: TaskRecord) => Partial<TaskRecord> | undefined,
  ): Promise<TaskRecord> {
    if (controller.signal.aborted) throw controller.signal.reason
    const updated = await this.#mutate(taskID, (record) => {
      if (controller.signal.aborted || isTerminal(record)) return undefined
      return change(record)
    })
    if (updated === undefined) throw controller.signal.reason ?? taskNotFound()
    if (isTerminal(updated) || controller.signal.aborted)
      throw controller.signal.reason ?? new Error('Task is no longer active')
    return updated
  }

  async #requestInput(
    taskID: string,
    controller: AbortController,
    incoming: Record<string, InputRequest>,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, InputResponse>> {
    // Stored records are plain JSON, so compare and store the same form (undefined dropped).
    const requests = JSON.parse(JSON.stringify(incoming)) as Record<string, InputRequest>
    const keys = Object.keys(requests)
    if (keys.length === 0) throw new Error('Input requests must not be empty')
    const signal = options?.signal
    let id = 0
    // The lookup runs inside the change callback, so a conflict re-read reruns it.
    await this.#activeMutation(taskID, controller, (record) => {
      // The same request (same key set, deep-equal contents), open or settled: re-attach to it
      // or replay its outcome.
      const same = record.inputs.find((entry) => equalJSON(entry.requests, requests))
      if (same !== undefined) {
        id = same.id
        return undefined
      }
      const reused = keys.find((key) =>
        record.inputs.some((entry) => Object.hasOwn(entry.requests, key)),
      )
      if (reused !== undefined) throw new TaskInputKeyReusedError(reused)
      if (signal?.aborted) throw signal.reason
      if (openInput(record) !== undefined) throw new Error('Input is already outstanding')
      const missing = missingInputCapabilities(requests, record.clientCapabilities)
      if (missing !== undefined) {
        const [key, request] = Object.entries(requests).find(
          ([, item]) => missing[INPUT_REQUEST_CAPABILITIES[item.method]] !== undefined,
        ) as [string, InputRequest]
        throw new RPCError({
          code: MISSING_REQUIRED_CLIENT_CAPABILITY,
          message: new MissingRequiredClientCapabilityError({
            key,
            method: request.method,
            requiredCapabilities: missing,
          }).message,
          data: { requiredCapabilities: missing },
        })
      }
      id = record.inputs.length + 1
      return {
        status: 'input_required',
        inputs: [...record.inputs, { id, requests, responses: {} }],
      }
    })
    const outcome = this.#waitForOutcome(taskID, controller, id)
    if (signal !== undefined) {
      const onAbort = () => {
        void this.#withdraw(taskID, id)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      const release = () => signal.removeEventListener('abort', onAbort)
      outcome.then(release, release)
    }
    return outcome
  }

  async #awaitInput(
    taskID: string,
    controller: AbortController,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, InputResponse>> {
    if (controller.signal.aborted) throw controller.signal.reason
    const record = await this.#store.get(taskID)
    const open = record === undefined ? undefined : openInput(record)
    if (open === undefined) throw new Error('No input is outstanding')
    return this.#requestInput(taskID, controller, open.requests, options)
  }

  /**
   * Resolves from committed records only. The listener is registered before the read, so a
   * commit made before registration is still seen. A failed read is retried with backoff until
   * it succeeds, the wait settles or the manager is disposed.
   */
  #waitForOutcome(
    taskID: string,
    controller: AbortController,
    id: number,
  ): Promise<Record<string, InputResponse>> {
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, InputResponse>>()
    let settled = false
    const settle = (settleWith: () => void) => {
      if (settled) return
      settled = true
      unlisten()
      controller.signal.removeEventListener('abort', onAbort)
      settleWith()
    }
    // Settled outcomes and terminal status never revert, so a stale record only keeps waiting.
    const check = (record: TaskRecord | undefined) => {
      if (record === undefined) return settle(() => reject(new Error('Task expired')))
      const entry = record.inputs.find((item) => item.id === id)
      if (entry?.outcome === 'answered') return settle(() => resolve(entry.responses))
      if (entry?.outcome === 'withdrawn')
        return settle(() => reject(new InputRequestWithdrawnError({ taskID, id })))
      if (isTerminal(record))
        settle(() =>
          reject(
            controller.signal.aborted
              ? controller.signal.reason
              : new Error('Task is no longer active'),
          ),
        )
    }
    const onAbort = () => settle(() => reject(controller.signal.reason))
    const unlisten = this.#listen(taskID, check)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (controller.signal.aborted) onAbort()
    void (async () => {
      let delay = WITHDRAW_BACKOFF_MS.initial
      while (!settled && !this.#disposed) {
        try {
          check(await this.#store.get(taskID))
          return
        } catch (error) {
          if (settled) return
          this.#events.fire('taskError', { taskID, error })
        }
        await sleep(delay, this.#disposal.signal).catch(() => {})
        delay = Math.min(delay * 2, WITHDRAW_BACKOFF_MS.max)
      }
      settle(() => reject(new Error('Task manager disposed')))
    })()
    return promise
  }

  /** Retries store failures with backoff until the entry settles, the task ends or disposal. */
  async #withdraw(taskID: string, id: number): Promise<void> {
    let delay = WITHDRAW_BACKOFF_MS.initial
    while (!this.#disposed) {
      try {
        await this.#mutate(taskID, (record) => {
          const open = openInput(record)
          return open?.id === id
            ? {
                status: 'working',
                inputs: settleLatest(record, { ...open, outcome: 'withdrawn' }),
              }
            : undefined
        })
        return
      } catch (error) {
        this.#events.fire('taskError', { taskID, error })
      }
      await sleep(delay, this.#disposal.signal).catch(() => {})
      delay = Math.min(delay * 2, WITHDRAW_BACKOFF_MS.max)
    }
  }

  async get(taskID: string, owner?: TaskOwner): Promise<DetailedTask> {
    return detailed(await this.#visible(taskID, owner))
  }

  async canAccess(taskID: string, owner?: TaskOwner): Promise<boolean> {
    try {
      await this.#visible(taskID, owner)
      return true
    } catch (error) {
      if (error instanceof RPCError && error.code === INVALID_PARAMS) return false
      throw error
    }
  }

  async update(
    taskID: string,
    responses: Record<string, InputResponse>,
    owner?: TaskOwner,
  ): Promise<void> {
    await this.#visible(taskID, owner)
    const updated = await this.#mutate(taskID, (record) => {
      const entries = Object.entries(responses)
      if (entries.length === 0) return undefined
      const open = openInput(record)
      const accepted: Record<string, InputResponse> = { ...open?.responses }
      for (const [key, response] of entries) {
        if (
          open === undefined ||
          !Object.hasOwn(open.requests, key) ||
          Object.hasOwn(open.responses, key)
        )
          throw new RPCError({
            code: INVALID_PARAMS,
            message: `Task is not awaiting input for ${key}`,
            data: { key },
          })
        if (!responseMatches(open.requests[key] as InputRequest, response))
          throw new RPCError({
            code: INVALID_PARAMS,
            message: `Input response kind does not match ${key}`,
          })
        accepted[key] = response
      }
      if (open === undefined) return undefined
      // The final answer closes the request in the same write that resumes the task.
      const answered = Object.keys(open.requests).every((key) => Object.hasOwn(accepted, key))
      return answered
        ? {
            status: 'working',
            inputs: settleLatest(record, { ...open, responses: accepted, outcome: 'answered' }),
          }
        : { inputs: settleLatest(record, { ...open, responses: accepted }) }
    })
    if (updated === undefined) throw taskNotFound()
  }

  async cancel(taskID: string, owner?: TaskOwner): Promise<void> {
    await this.#visible(taskID, owner)
    const updated = await this.#mutate(
      taskID,
      (record) => (isTerminal(record) ? undefined : { status: 'cancelled' }),
      () => this.#abort(taskID, new Error('Task cancelled')),
    )
    if (updated === undefined) throw taskNotFound()
  }

  async recover(tools: ToolDefinitions): Promise<void> {
    await this.#ready
    if (this.#disposed) throw new Error('Task manager disposed')
    for (const taskID of [...this.#hidden]) {
      if (this.#recovering.has(taskID) || !this.#hidden.has(taskID)) continue
      this.#recovering.add(taskID)
      try {
        if (this.#disposed) return
        const record = await this.#store.get(taskID)
        if (record === undefined || (await this.#expire(record))) continue
        const tool = tools[record.toolName]
        if (tool === undefined || this.#recoverCallback === undefined) {
          await this.#failInterrupted(taskID)
          continue
        }
        let resumedWork: TaskWork | undefined
        try {
          await this.#recoverCallback(record, async (work) => {
            if (resumedWork !== undefined) throw new Error('Task already resumed')
            resumedWork = work
          })
        } catch {
          if (!this.#disposed) await this.#failInterrupted(taskID)
          continue
        }
        if (this.#disposed) return
        const latest = await this.#store.get(taskID)
        if (latest === undefined || (await this.#expire(latest))) continue
        if (this.#disposed) return
        if (isTerminal(latest)) {
          this.#hidden.delete(taskID)
          continue
        }
        if (resumedWork === undefined) await this.#failInterrupted(taskID)
        else {
          this.#attach(taskID, tool, resumedWork, latest.requestMeta)
          this.#hidden.delete(taskID)
        }
      } finally {
        this.#recovering.delete(taskID)
      }
    }
  }

  async dispose(): Promise<void> {
    await this.#ready
    this.#disposed = true
    this.#disposal.abort()
    clearInterval(this.#timer)
    for (const taskID of this.#controllers.keys())
      this.#abort(taskID, new Error('Task manager disposed'))
  }
}

export function createTaskManager(params: TaskManagerParams = {}): TaskManager {
  return new ManagedTasks(params)
}
