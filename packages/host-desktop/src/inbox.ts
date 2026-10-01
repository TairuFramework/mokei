import { TaskInputWithdrawnError } from '@mokei/context-client'
import type { ElicitRequest, ElicitResult } from '@mokei/context-protocol'
import { EventEmitter } from '@sozai/event'

import {
  type ContentValidator,
  createContentValidator,
  type FormParams,
  type RequestedSchema,
} from './form.js'

export type DesktopElicitRequest = {
  key?: string
  params: ElicitRequest['params']
  signal: AbortSignal
}

export type InboxPrompt = (signal: AbortSignal) => Promise<ElicitResult>

export type PendingInput = {
  id: string
  key?: string
  message: string
  requestedSchema: RequestedSchema
  createdAt: number
  canPrompt: boolean
}

export type InputInboxEvents = {
  added: PendingInput
  settled: { id: string; action: ElicitResult['action'] }
  removed: { id: string; reason: 'withdrawn' | 'aborted' | 'disposed' }
}

export type InputInbox = {
  readonly events: EventEmitter<InputInboxEvents>
  readonly hasAnswerSurface: boolean
  /** `true` once `dispose()` has run; `add` then rejects with `InboxDisposedError`. */
  readonly disposed: boolean
  registerAnswerSurface(): () => void
  add(request: DesktopElicitRequest, options?: { prompt?: InboxPrompt }): Promise<ElicitResult>
  list(): Array<PendingInput>
  get(id: string): PendingInput | undefined
  answer(id: string, content: ElicitResult['content']): boolean
  decline(id: string): boolean
  cancel(id: string): boolean
  prompt(id: string, options?: { signal?: AbortSignal }): Promise<ElicitResult>
  dispose(): void
}

export class InboxDisposedError extends Error {
  constructor(params: { cause?: unknown } = {}) {
    super('Input inbox disposed', { cause: params.cause })
    this.name = 'InboxDisposedError'
  }
}

export class InboxAnswerInvalidError extends Error {
  #id: string
  #issues: Array<string>

  constructor(params: { id: string; issues: Array<string> }) {
    super(`Invalid answer for input ${params.id}: ${params.issues.join('; ')}`)
    this.name = 'InboxAnswerInvalidError'
    this.#id = params.id
    this.#issues = params.issues
  }

  get id(): string {
    return this.#id
  }

  get issues(): Array<string> {
    return this.#issues
  }
}

type Entry = {
  input: PendingInput
  /** Compiled at `add`, so a schema that cannot be compiled is known before any answer. */
  validate: ContentValidator
  signal: AbortSignal
  onAbort: () => void
  resolve: (result: ElicitResult) => void
  reject: (reason: unknown) => void
  prompt?: InboxPrompt
  promptAbort?: AbortController
  promptResult?: Promise<ElicitResult>
  promptWaiters: number
  outcome?: { result: ElicitResult } | { error: unknown }
}

export function createInputInbox(): InputInbox {
  const events = new EventEmitter<InputInboxEvents>()
  const entries = new Map<string, Entry>()
  let surfaces = 0
  let disposed = false

  function detach(entry: Entry, outcome: NonNullable<Entry['outcome']>): void {
    entry.outcome = outcome
    entries.delete(entry.input.id)
    entry.signal.removeEventListener('abort', entry.onAbort)
    entry.promptAbort?.abort('error' in outcome ? outcome.error : undefined)
  }

  function settle(entry: Entry, result: ElicitResult): void {
    detach(entry, { result })
    events.fire('settled', { id: entry.input.id, action: result.action })
    entry.resolve(result)
  }

  function remove(
    entry: Entry,
    reason: InputInboxEvents['removed']['reason'],
    error: unknown,
  ): void {
    detach(entry, { error })
    events.fire('removed', { id: entry.input.id, reason })
    entry.reject(error)
  }

  function settleById(id: string, result: ElicitResult): boolean {
    const entry = entries.get(id)
    if (entry == null) return false
    settle(entry, result)
    return true
  }

  function add(
    request: DesktopElicitRequest,
    options: { prompt?: InboxPrompt } = {},
  ): Promise<ElicitResult> {
    if (request.params.mode === 'url') {
      throw new TypeError('Input inbox accepts form-mode requests only')
    }
    if (disposed) return Promise.reject(new InboxDisposedError())
    if (request.signal.aborted) return Promise.reject(request.signal.reason)

    const params = request.params as FormParams
    return new Promise<ElicitResult>((resolve, reject) => {
      const input: PendingInput = {
        id: crypto.randomUUID(),
        key: request.key,
        message: params.message,
        requestedSchema: params.requestedSchema,
        createdAt: Date.now(),
        canPrompt: options.prompt != null,
      }
      const entry: Entry = {
        input,
        validate: createContentValidator(params.requestedSchema),
        signal: request.signal,
        onAbort: () => {
          const reason = request.signal.reason
          remove(entry, reason instanceof TaskInputWithdrawnError ? 'withdrawn' : 'aborted', reason)
        },
        resolve,
        reject,
        prompt: options.prompt,
        promptWaiters: 0,
      }
      entries.set(input.id, entry)
      request.signal.addEventListener('abort', entry.onAbort, { once: true })
      events.fire('added', input)
    })
  }

  function prompt(id: string, options: { signal?: AbortSignal } = {}): Promise<ElicitResult> {
    const entry = entries.get(id)
    if (entry == null) return Promise.reject(new Error(`No pending input ${id}`))
    if (entry.prompt == null) return Promise.reject(new Error(`Input ${id} cannot be prompted`))
    const { signal } = options
    if (signal?.aborted) return Promise.reject(signal.reason)

    let run = entry.promptResult
    if (run == null) {
      const controller = new AbortController()
      entry.promptAbort = controller
      run = (async () => {
        const finalOutcome = (): ElicitResult => {
          const outcome = entry.outcome
          if (outcome != null && 'error' in outcome) throw outcome.error
          return (outcome as { result: ElicitResult }).result
        }
        try {
          const result = await entry.prompt?.(controller.signal)
          if (entries.get(id) !== entry) return finalOutcome()
          if (result == null) throw new Error(`Input ${id} prompt returned no result`)
          settle(entry, result)
          return result
        } catch (error) {
          if (entries.get(id) !== entry) return finalOutcome()
          // Leave the entry pending so it can be prompted again
          if (entry.promptAbort === controller) {
            entry.promptResult = undefined
            entry.promptAbort = undefined
          }
          throw error
        }
      })()
      entry.promptResult = run
    }

    entry.promptWaiters++
    return new Promise<ElicitResult>((resolve, reject) => {
      let active = true
      const finish = (callback: () => void) => {
        if (!active) return
        active = false
        signal?.removeEventListener('abort', onAbort)
        entry.promptWaiters--
        callback()
      }
      const onAbort = () => {
        const outcome = entry.outcome
        if (outcome != null) {
          finish(() => {
            if ('error' in outcome) reject(outcome.error)
            else resolve(outcome.result)
          })
          return
        }
        finish(() => {
          if (entry.promptWaiters === 0) entry.promptAbort?.abort(signal?.reason)
          reject(signal?.reason)
        })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      run.then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error)),
      )
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const entry of [...entries.values()]) {
      remove(entry, 'disposed', new InboxDisposedError())
    }
  }

  return {
    events,
    get hasAnswerSurface() {
      return surfaces > 0
    },
    get disposed() {
      return disposed
    },
    registerAnswerSurface() {
      surfaces++
      let active = true
      return () => {
        if (!active) return
        active = false
        surfaces--
        if (surfaces === 0 && entries.size > 0) {
          console.error(
            `[mokei/host-desktop] Last input answer surface closed; cancelling ${entries.size} pending inputs`,
          )
          for (const entry of [...entries.values()]) settle(entry, { action: 'cancel' })
        }
      }
    },
    add,
    list: () => [...entries.values()].map((entry) => entry.input),
    get: (id) => entries.get(id)?.input,
    answer(id, content) {
      const entry = entries.get(id)
      if (entry == null) return false
      const issues = entry.validate(content)
      if (issues.length > 0) throw new InboxAnswerInvalidError({ id, issues })
      settle(entry, { action: 'accept', content })
      return true
    },
    decline: (id) => settleById(id, { action: 'decline' }),
    cancel: (id) => settleById(id, { action: 'cancel' }),
    prompt,
    dispose,
  }
}
