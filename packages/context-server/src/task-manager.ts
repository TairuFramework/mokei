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
import { EventEmitter, type EventsSource } from '@sozai/event'

import { missingInputCapabilities } from './mrtr.js'
import {
  createMemoryTaskStore,
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
  setStatus(message: string): Promise<void>
  requestInput(
    requests: Record<string, InputRequest>,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, InputResponse>>
  awaitInput(options?: { signal?: AbortSignal }): Promise<Record<string, InputResponse>>
  checkpoint(resumeData: JSONValue): Promise<void>
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
  events: EventsSource<{ taskStatus: DetailedTask }>
  create(params: {
    toolName: string
    tool: GenericToolDefinition
    clientCapabilities: ClientCapabilities
    owner?: TaskOwner
    work: TaskWork
    resumeData?: JSONValue
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
  if (record.status === 'input_required')
    return { ...base, status: 'input_required', inputRequests: record.inputRequests ?? {} }
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

type PendingInput = {
  resolve: (responses: Record<string, InputResponse>) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

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
  #pending = new Map<string, PendingInput>()
  #events = new EventEmitter<{ taskStatus: DetailedTask }>()
  #timer: ReturnType<typeof setInterval>
  #disposed = false

  constructor(params: TaskManagerParams) {
    this.#store = params.store ?? createMemoryTaskStore()
    this.#ttlMs = params.ttlMs ?? 3_600_000
    this.#pollIntervalMs = params.pollIntervalMs ?? 1_000
    this.#now = params.now ?? Date.now
    this.#recoverCallback = params.recover
    this.#ready = this.#initialise()
    this.#timer = setInterval(
      () => {
        void this.#sweep().catch(() => {})
      },
      Math.max(1, Math.min(this.#ttlMs, 1_000)),
    )
    this.#timer.unref?.()
  }

  get events(): EventsSource<{ taskStatus: DetailedTask }> {
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

  async #mutate(
    taskID: string,
    change: (record: TaskRecord) => Partial<TaskRecord> | undefined,
  ): Promise<TaskRecord | undefined> {
    while (true) {
      const record = await this.#store.get(taskID)
      if (record === undefined) return undefined
      const patch = change(record)
      if (patch === undefined) return record
      try {
        const updated = await this.#store.update(
          taskID,
          { ...patch, lastUpdatedAt: new Date(this.#now()).toISOString() },
          { revision: record.revision },
        )
        this.#events.fire('taskStatus', detailed(updated))
        return updated
      } catch (error) {
        if ((await this.#store.get(taskID)) === undefined) return undefined
        if (!(error instanceof TaskStoreConflictError)) throw error
      }
    }
  }

  #abort(taskID: string, reason: unknown): void {
    this.#controllers.get(taskID)?.abort(reason)
    this.#controllers.delete(taskID)
    const pending = this.#pending.get(taskID)
    if (pending !== undefined) {
      this.#pending.delete(taskID)
      pending.signal?.removeEventListener('abort', pending.onAbort as EventListener)
      pending.reject(reason)
    }
  }

  async #expire(record: TaskRecord): Promise<boolean> {
    if (record.ttlMs === null || this.#now() < Date.parse(record.createdAt) + record.ttlMs)
      return false
    await this.#store.delete(record.taskID)
    this.#hidden.delete(record.taskID)
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
    for (const record of await this.#store.list({ status: [...ALL_STATUSES] }))
      await this.#expire(record)
  }

  async create(params: {
    toolName: string
    tool: GenericToolDefinition
    clientCapabilities: ClientCapabilities
    owner?: TaskOwner
    work: TaskWork
    resumeData?: JSONValue
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
      issuedInputKeys: [],
      ...(params.owner !== undefined && { owner: params.owner }),
      ...(params.resumeData !== undefined && { resumeData: params.resumeData }),
    }
    await this.#store.create(record)
    this.#events.fire('taskStatus', detailed(record))
    this.#attach(record.taskID, params.tool, params.work)
    return { ...detailed(record), resultType: 'task' }
  }

  #attach(taskID: string, tool: GenericToolDefinition, work: TaskWork): void {
    const controller = new AbortController()
    this.#controllers.set(taskID, controller)
    const handle: TaskHandle = {
      taskID,
      signal: controller.signal,
      setStatus: async (message) => {
        await this.#activeMutation(taskID, controller, () => ({ statusMessage: message }))
      },
      checkpoint: async (resumeData) => {
        await this.#activeMutation(taskID, controller, () => ({ resumeData }))
      },
      requestInput: (requests, options) =>
        this.#requestInput(taskID, controller, requests, options),
      awaitInput: (options) => this.#awaitInput(taskID, controller, options),
    }
    void (async () => {
      let outcome: { result: CallToolResult } | { error: unknown }
      try {
        outcome = { result: await work(handle) }
      } catch (error) {
        outcome = { error }
      }
      if (controller.signal.aborted || this.#disposed) return
      const settled = settleToolOutcome(tool, outcome)
      await this.#mutate(taskID, (record) =>
        isTerminal(record)
          ? undefined
          : 'result' in settled
            ? { status: 'completed', result: { ...settled.result, resultType: 'complete' } }
            : { status: 'failed', error: settled.error },
      )
    })()
      .catch(() => {})
      .finally(() => {
        if (this.#controllers.get(taskID) === controller) this.#controllers.delete(taskID)
      })
  }

  async #activeMutation(
    taskID: string,
    controller: AbortController,
    change: (record: TaskRecord) => Partial<TaskRecord>,
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
    requests: Record<string, InputRequest>,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, InputResponse>> {
    const keys = Object.keys(requests)
    if (keys.length === 0) throw new Error('Input requests must not be empty')
    const current = await this.#store.get(taskID)
    if (current === undefined) throw taskNotFound()
    const missing = missingInputCapabilities(requests, current.clientCapabilities)
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
    await this.#activeMutation(taskID, controller, (record) => {
      if (record.status === 'input_required') throw new Error('Input is already outstanding')
      if (keys.some((key) => record.issuedInputKeys.includes(key)))
        throw new Error('Input key already issued')
      return {
        status: 'input_required',
        inputRequests: requests,
        inputResponses: {},
        issuedInputKeys: [...record.issuedInputKeys, ...keys],
      }
    })
    return this.#awaitInput(taskID, controller, options)
  }

  async #awaitInput(
    taskID: string,
    controller: AbortController,
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, InputResponse>> {
    if (controller.signal.aborted) throw controller.signal.reason
    if (options?.signal?.aborted) {
      await this.#withdraw(taskID)
      throw options.signal.reason
    }
    const record = await this.#store.get(taskID)
    if (record?.status !== 'input_required') throw new Error('No input is outstanding')
    if (this.#pending.has(taskID)) throw new Error('Input is already awaited')
    const pending = Promise.withResolvers<Record<string, InputResponse>>()
    const entry: PendingInput = {
      resolve: pending.resolve,
      reject: pending.reject,
      signal: options?.signal,
    }
    if (options?.signal !== undefined) {
      entry.onAbort = () => {
        void this.#withdraw(taskID)
          .catch(() => {})
          .then(() => {
            if (this.#pending.get(taskID) === entry) {
              this.#pending.delete(taskID)
              entry.reject(options.signal?.reason)
            }
          })
      }
      options.signal.addEventListener('abort', entry.onAbort, { once: true })
    }
    this.#pending.set(taskID, entry)
    if (controller.signal.aborted) {
      this.#abort(taskID, controller.signal.reason)
    } else if (options?.signal?.aborted) {
      entry.onAbort?.()
    }
    this.#resolveInput(taskID, record)
    const latest = await this.#store.get(taskID)
    if (latest !== undefined) this.#resolveInput(taskID, latest)
    return pending.promise
  }

  async #withdraw(taskID: string): Promise<void> {
    await this.#mutate(taskID, (record) =>
      record.status === 'input_required'
        ? { status: 'working', inputRequests: undefined, inputResponses: undefined }
        : undefined,
    )
  }

  #resolveInput(taskID: string, record: TaskRecord): void {
    const pending = this.#pending.get(taskID)
    if (pending === undefined || record.status !== 'input_required') return
    const keys = Object.keys(record.inputRequests ?? {})
    if (!keys.every((key) => record.inputResponses?.[key] !== undefined)) return
    void this.#mutate(taskID, (latest) =>
      latest.status === 'input_required'
        ? { status: 'working', inputRequests: undefined, inputResponses: undefined }
        : undefined,
    )
      .then((updated) => {
        if (
          updated?.status !== 'working' ||
          this.#pending.get(taskID) !== pending ||
          pending.signal?.aborted
        )
          return
        this.#pending.delete(taskID)
        pending.signal?.removeEventListener('abort', pending.onAbort as EventListener)
        pending.resolve(record.inputResponses ?? {})
      })
      .catch(() => {})
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
      if (record.status !== 'input_required') return undefined
      const accepted: Record<string, InputResponse> = { ...record.inputResponses }
      for (const [key, response] of Object.entries(responses)) {
        const request = record.inputRequests?.[key]
        if (request === undefined || accepted[key] !== undefined) continue
        if (!responseMatches(request, response))
          throw new RPCError({
            code: INVALID_PARAMS,
            message: `Input response kind does not match ${key}`,
          })
        accepted[key] = response
      }
      return Object.keys(accepted).length === Object.keys(record.inputResponses ?? {}).length
        ? undefined
        : { inputResponses: accepted }
    })
    if (updated === undefined) throw taskNotFound()
    this.#resolveInput(taskID, updated)
  }

  async cancel(taskID: string, owner?: TaskOwner): Promise<void> {
    await this.#visible(taskID, owner)
    const updated = await this.#mutate(taskID, (record) =>
      isTerminal(record)
        ? undefined
        : { status: 'cancelled', inputRequests: undefined, inputResponses: undefined },
    )
    if (updated === undefined) throw taskNotFound()
    if (updated.status === 'cancelled') this.#abort(taskID, new Error('Task cancelled'))
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
          this.#attach(taskID, tool, resumedWork)
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
    clearInterval(this.#timer)
    for (const taskID of this.#controllers.keys())
      this.#abort(taskID, new Error('Task manager disposed'))
  }
}

export function createTaskManager(params: TaskManagerParams = {}): TaskManager {
  return new ManagedTasks(params)
}
