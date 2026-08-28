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
 * Number of unread SSE frames the stream buffers before it applies backpressure to writers.
 * Once the readable side holds this many un-consumed chunks, `writer.write()` parks until the
 * network reader drains one — so a slow reader bounds the buffer instead of growing it without
 * limit. Count-based (frames, not bytes): SSE frames are small and the concern is a stalled
 * consumer, not payload size.
 */
export const SSE_STREAM_HIGH_WATER_MARK = 16

/**
 * Create a stream pair for SSE output. The writable side accepts strings
 * (SSE-formatted text), and the readable side produces Uint8Array chunks
 * suitable for use as a Response body.
 *
 * Backpressure is reader-demand-aware: `writer.write()` resolves immediately while the readable
 * side has room, and parks once it holds `highWaterMark` un-consumed frames (default
 * {@link SSE_STREAM_HIGH_WATER_MARK}), resuming when the network reader pulls. A genuinely slow
 * reader therefore bounds the buffer rather than letting it grow without limit. A resuming GET
 * stream raises the mark to fit its whole replay snapshot, so those frames can be buffered before
 * a reader attaches without parking.
 *
 * Not a `TransformStream`: its readable and writable sides are joined, so cancelling the readable
 * (a client disconnect) errors the writable and makes every later `writer.write()` reject. SSE
 * writers are retained and written to after a client goes away (a session GET stream, a pending
 * POST stream), and such a write must be a silent no-op — a rejection would error the server's
 * outbound transport and skip the stream's own teardown. The hand-built pair below keeps the
 * `closed` guard that turns a post-cancel write into that no-op.
 */
export function createSSEStream(highWaterMark: number = SSE_STREAM_HIGH_WATER_MARK): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<string>
  /**
   * Tear down from the writable side: mark the pair closed and wake a write parked on
   * backpressure so it resolves as a no-op. Without this, closing the writable while a write is
   * parked would wedge — `writer.close()` serializes behind the in-flight write, and only a
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
      // Park while the readable queue is full — the backpressure that bounds a slow reader.
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
