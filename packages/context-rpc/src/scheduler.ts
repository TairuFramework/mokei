import { INTERNAL_ERROR, type RequestID, type Response } from '@mokei/context-protocol'
import { defer } from '@sozai/async'

import { RPCError } from './error.js'

/**
 * Request handlers allowed to run at once. An order of magnitude below nothing in
 * particular — it matches `DEFAULT_MAX_STATELESS_EXCHANGES` in `@mokei/http-server`, the
 * only other place mokei bounds concurrent work.
 */
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 100

/** Requests allowed to wait for a slot before further requests are refused. */
export const DEFAULT_MAX_QUEUED_REQUESTS = 1000

/** Runs one request's handler under the signal the scheduler owns for it. */
export type RunRequest = (signal: AbortSignal) => Promise<Response | null>

export type RequestSchedulerParams = {
  maxConcurrentRequests?: number
  maxQueuedRequests?: number
}

type QueuedRequest = {
  controller: AbortController
  resolve: (response: Response | null) => void
  run: RunRequest
}

/**
 * Bounds concurrent request handlers without ever making the read loop wait.
 *
 * The controller is created when a request is *accepted*, not when it starts running, so a
 * `notifications/cancelled` that arrives while the request is still queued finds it and drops
 * it before its handler ever runs. Neither a cancelled nor an aborted request answers on the
 * wire, per MCP's "a cancelled request SHOULD NOT be responded to".
 */
export class RequestScheduler {
  #maxConcurrent: number
  #maxQueued: number
  // Insertion-ordered, which is what makes the queue FIFO.
  #queued: Map<RequestID, QueuedRequest> = new Map()
  #running: Map<RequestID, AbortController> = new Map()

  constructor(params: RequestSchedulerParams = {}) {
    this.#maxConcurrent = params.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS
    this.#maxQueued = params.maxQueuedRequests ?? DEFAULT_MAX_QUEUED_REQUESTS
  }

  get queuedCount(): number {
    return this.#queued.size
  }

  get runningCount(): number {
    return this.#running.size
  }

  /**
   * Runs `run` now if a slot is free, queues it if not, and refuses it past the queue bound.
   * Resolves to the response to write, or `null` when nothing should be written.
   */
  schedule(id: RequestID, run: RunRequest): Promise<Response | null> {
    if (this.#running.size < this.#maxConcurrent) {
      return this.#start(id, new AbortController(), run)
    }
    if (this.#queued.size >= this.#maxQueued) {
      // INTERNAL_ERROR rather than a new code: mokei's custom codes all come from SEPs, so
      // inventing one here risks colliding with a future spec assignment.
      return Promise.resolve(new RPCError(INTERNAL_ERROR, 'Server busy').toResponse(id))
    }
    const { promise, resolve } = defer<Response | null>()
    this.#queued.set(id, { controller: new AbortController(), resolve, run })
    return promise
  }

  /** Drops a queued request, or aborts a running one's signal. */
  cancel(id: RequestID): void {
    const queued = this.#queued.get(id)
    if (queued != null) {
      this.#queued.delete(id)
      queued.controller.abort()
      queued.resolve(null)
      return
    }
    this.#running.get(id)?.abort()
  }

  /** Aborts every running handler and drops every queued request. */
  abortAll(reason: Error): void {
    for (const [id, queued] of Array.from(this.#queued.entries())) {
      this.#queued.delete(id)
      queued.controller.abort(reason)
      queued.resolve(null)
    }
    for (const controller of Array.from(this.#running.values())) {
      controller.abort(reason)
    }
  }

  #start(id: RequestID, controller: AbortController, run: RunRequest): Promise<Response | null> {
    this.#running.set(id, controller)
    return run(controller.signal).finally(() => {
      this.#running.delete(id)
      this.#drain()
    })
  }

  #drain(): void {
    while (this.#running.size < this.#maxConcurrent) {
      const next = this.#queued.entries().next()
      if (next.done) {
        return
      }
      const [id, queued] = next.value
      this.#queued.delete(id)
      this.#start(id, queued.controller, queued.run).then(queued.resolve, () => {
        // A handler that rejects has no response to write; the caller of `schedule` for a
        // queued request cannot observe the rejection, so it settles as "write nothing".
        queued.resolve(null)
      })
    }
  }
}
