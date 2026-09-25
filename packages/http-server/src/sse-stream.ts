/**
 * Headers every SSE response on this transport carries. Frozen: the object is shared by
 * every SSE response the handler builds and exported from the package, so a consumer that
 * mutated it would poison all of them.
 */
export const SSE_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
})

/**
 * Unread SSE frame limit. A writer parks until the reader drains a frame,
 * bounding memory for a stalled consumer. This counts frames, not bytes.
 */
export const SSE_STREAM_HIGH_WATER_MARK = 16

/**
 * Pair SSE strings with response-body bytes. Writes park at `highWaterMark`
 * unread frames (default {@link SSE_STREAM_HIGH_WATER_MARK}); replaying GET
 * streams raise that mark to buffer a snapshot before a reader attaches.
 *
 * A `TransformStream` would reject writes after readable cancellation, which
 * could poison the server's outbound transport. This pair makes those writes
 * no-ops while retaining backpressure for active readers.
 */
export function createSSEStream(highWaterMark: number = SSE_STREAM_HIGH_WATER_MARK): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<string>
  /**
   * Tear down from the writable side: mark the pair closed and wake a write parked on
   * backpressure so it resolves as a no-op. Without this, closing the writable while a write is
   * parked would wedge -- `writer.close()` serializes behind the in-flight write, and only a
   * reader pull or `readable.cancel()` would otherwise release it. Safe to call more than once.
   */
  release: () => void
} {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  // Set while a write is parked on backpressure; the reader's `pull` (or a cancel) releases it.
  let releaseDemand: (() => void) | null = null

  const wake = (): void => {
    releaseDemand?.()
    releaseDemand = null
  }

  const readable = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
      },
      pull() {
        // The reader drained below the high-water mark: release a write parked for demand.
        wake()
      },
      cancel() {
        closed = true
        // Release any parked write so it observes `closed` and resolves as a no-op.
        wake()
      },
    },
    new CountQueuingStrategy({ highWaterMark }),
  )

  const writable = new WritableStream<string>({
    async write(chunk) {
      // Park while the readable queue is full -- the backpressure that bounds a slow reader.
      // `desiredSize` is null only once the stream is closed or errored, so the guard exits then.
      while (!closed && controller.desiredSize != null && controller.desiredSize <= 0) {
        await new Promise<void>((resolve) => {
          releaseDemand = resolve
        })
      }
      if (closed) return
      controller.enqueue(encoder.encode(chunk))
    },
    close() {
      closed = true
      // Tolerant of a prior `release()` (or abort): closing an already-closed/errored controller
      // throws, and here that just means the readable end is already finished.
      try {
        controller.close()
      } catch {}
    },
    abort(reason) {
      if (!closed) {
        closed = true
        controller.error(reason)
      }
    },
  })

  const release = (): void => {
    closed = true
    wake()
  }

  return { readable, writable, release }
}
