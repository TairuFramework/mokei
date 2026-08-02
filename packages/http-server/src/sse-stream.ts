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
 * Create a stream pair for SSE output. The writable side accepts strings
 * (SSE-formatted text), and the readable side produces Uint8Array chunks
 * suitable for use as a Response body.
 */
export function createSSEStream(): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<string>
} {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      closed = true
    },
  })

  const writable = new WritableStream<string>({
    write(chunk) {
      if (!closed) {
        controller.enqueue(encoder.encode(chunk))
      }
    },
    close() {
      if (!closed) {
        closed = true
        controller.close()
      }
    },
    abort(reason) {
      if (!closed) {
        closed = true
        controller.error(reason)
      }
    },
  })

  return { readable, writable }
}
