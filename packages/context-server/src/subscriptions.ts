import type { ServerNotification } from '@mokei/context-protocol'
import { defer } from '@sozai/async'

/**
 * Pending frames a `SubscriptionWriter` accepts before it treats the subscriber as too slow to
 * keep up. Well above what a healthy consumer should ever accumulate -- it exists purely as a
 * backstop against a stalled transport turning into unbounded memory growth.
 */
export const DEFAULT_MAX_PENDING_FRAMES = 256

/**
 * Thrown -- and handed to `onFailure`/`sink.close()` -- when a `SubscriptionWriter`'s queue would
 * grow past `maxPendingFrames`: the subscriber isn't draining notifications fast enough to keep
 * up with the stream.
 */
export class SubscriptionBackpressureError extends Error {
  name = 'SubscriptionBackpressureError'

  constructor(maxPendingFrames: number) {
    super(
      `Subscription writer exceeded its backpressure bound of ${maxPendingFrames} pending frame(s)`,
    )
  }
}

/**
 * Where a `SubscriptionWriter` delivers notifications. Deliberately has no `writeTerminalResult`:
 * the terminal result of the long-running request this subscription rides on flows through the
 * serving server's own RPC write path, not through this sink.
 */
export type SubscriptionSink = {
  writeNotification(notification: ServerNotification): Promise<void>
  close(reason?: Error): void
}

export type SubscriptionWriterParams = {
  sink: SubscriptionSink
  /** @default DEFAULT_MAX_PENDING_FRAMES */
  maxPendingFrames?: number
  /** Called at most once, when the writer stops itself: on backpressure, or when a write to
   * the sink itself rejects. */
  onFailure: (error: Error) => void
}

type QueuedFrame = {
  notification: ServerNotification
  resolve: () => void
  reject: (reason: unknown) => void
}

/**
 * Serializes notification delivery to one `SubscriptionSink`.
 *
 * Frames handed to `enqueue()` are written one at a time, strictly in the order they were
 * enqueued, and never concurrently -- the next `writeNotification()` call is only made once the
 * previous one has settled. Each `enqueue()` call's returned promise settles when *that specific*
 * frame's `writeNotification()` settles, not when some later frame is written.
 *
 * Delivery is bounded by `maxPendingFrames`: a queue deeper than that means the subscriber isn't
 * draining fast enough, so the writer stops accepting further frames, reports a
 * `SubscriptionBackpressureError` through `onFailure`, and closes the sink.
 *
 * A real `writeNotification()` rejection is fatal too: the sink itself is broken, so the writer
 * stops draining, reports the rejection through `onFailure`, and closes the sink -- the same
 * path as backpressure, rather than silently looping forever against a dead sink.
 */
export class SubscriptionWriter {
  #sink: SubscriptionSink
  #maxPendingFrames: number
  #onFailure: (error: Error) => void

  // Frames accepted but not yet dispatched to the sink. The frame currently in flight (if any)
  // has already been shifted out of this array -- see #drain().
  #queue: Array<QueuedFrame> = []
  // Count of frames accepted but not yet settled: queued frames plus the one in flight, if any.
  // Checked against #maxPendingFrames on every enqueue() to decide whether to accept it.
  #pending = 0
  // True while a writeNotification() call is outstanding, so #drain() never starts a second one.
  #draining = false
  // Set once, either by backpressure or by abort(); once set, no further frame is accepted.
  #failure: Error | null = null
  // Resolves the next time #pending returns to 0. Recreated each time #pending leaves 0.
  #idle: Promise<void> = Promise.resolve()
  #settleIdle: (() => void) | null = null

  constructor(params: SubscriptionWriterParams) {
    this.#sink = params.sink
    this.#maxPendingFrames = params.maxPendingFrames ?? DEFAULT_MAX_PENDING_FRAMES
    this.#onFailure = params.onFailure
  }

  /**
   * Queues `notification` for delivery. Resolves once *this* frame's `writeNotification()` call
   * resolves, rejects if it rejects -- never settles early because a later frame was written.
   *
   * Rejects immediately, without touching the sink, once the writer has failed (backpressure or
   * `abort()`): callers stop being able to enqueue past that point.
   */
  enqueue(notification: ServerNotification): Promise<void> {
    if (this.#failure != null) {
      return Promise.reject(this.#failure)
    }
    if (this.#pending >= this.#maxPendingFrames) {
      const error = new SubscriptionBackpressureError(this.#maxPendingFrames)
      this.#fail(error, { notify: true })
      return Promise.reject(error)
    }

    if (this.#pending === 0) {
      this.#idle = new Promise((resolve) => {
        this.#settleIdle = resolve
      })
    }
    this.#pending++

    const { promise, resolve, reject } = defer<void>()
    this.#queue.push({ notification, resolve, reject })
    this.#drain()
    return promise
  }

  /** Resolves once every frame accepted so far has settled -- the queue is fully drained. */
  flush(): Promise<void> {
    return this.#idle
  }

  /**
   * Stops the writer: no further frame is accepted, and any frame still waiting in the queue
   * (not yet handed to the sink) rejects with `reason`. A frame already in flight finishes its
   * `writeNotification()` call undisturbed -- it cannot be un-sent.
   *
   * Unlike backpressure, an explicit `abort()` does not call `onFailure` or `sink.close()`: the
   * caller already knows why it stopped the writer and owns the sink's lifecycle.
   */
  abort(reason: Error): void {
    this.#fail(reason, { notify: false })
  }

  #fail(error: Error, { notify }: { notify: boolean }): void {
    if (this.#failure != null) {
      return
    }
    this.#failure = error

    const queued = this.#queue
    this.#queue = []
    for (const frame of queued) {
      this.#pending--
      frame.reject(error)
    }

    if (notify) {
      this.#onFailure(error)
      this.#sink.close(error)
    }

    if (this.#pending === 0) {
      this.#settleIdle?.()
    }
  }

  #drain(): void {
    if (this.#draining || this.#failure != null) {
      return
    }
    const next = this.#queue.shift()
    if (next == null) {
      return
    }

    this.#draining = true
    this.#sink.writeNotification(next.notification).then(
      () => {
        this.#draining = false
        this.#pending--
        next.resolve()
        if (this.#pending === 0) {
          this.#settleIdle?.()
        }
        this.#drain()
      },
      (error: unknown) => {
        // A real write failure is fatal to the whole writer: looping back into #drain() here
        // would just keep calling writeNotification() on a sink that already proved broken.
        // Route it through the same fatal path as backpressure -- onFailure + sink.close() +
        // rejecting every still-queued frame -- then reject this in-flight frame's own promise
        // with the same error. Unlike the overflow branch, this frame's write itself failed, so
        // (unlike overflow, where an in-flight write is left to resolve normally) it rejects
        // rather than resolving.
        this.#draining = false
        this.#pending--
        const failure = error instanceof Error ? error : new Error(String(error))
        next.reject(failure)
        this.#fail(failure, { notify: true })
        // No further #drain(): #fail() has already emptied and rejected whatever was left
        // queued, and the writer refuses new frames from here on.
      },
    )
  }
}
