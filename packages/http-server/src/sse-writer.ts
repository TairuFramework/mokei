export type SSEEvent = {
  id: string
  data: string
}

export type SSEWriterParams = {
  writable: WritableStream<string>
  streamID: string
  replayBufferSize: number
  onEvent?: (event: SSEEvent) => void
}

export class SSEWriter {
  #writer: WritableStreamDefaultWriter<string>
  #streamID: string
  #counter = 0
  #buffer: Array<SSEEvent>
  #bufferSize: number
  #bufferStart = 0
  #bufferCount = 0
  #closed = false
  #onEvent: ((event: SSEEvent) => void) | undefined

  constructor(params: SSEWriterParams) {
    this.#writer = params.writable.getWriter()
    this.#streamID = params.streamID
    this.#bufferSize = params.replayBufferSize
    this.#buffer = new Array<SSEEvent>(params.replayBufferSize)
    this.#onEvent = params.onEvent
  }

  get streamID(): string {
    return this.#streamID
  }

  #nextID(): string {
    this.#counter++
    return `${this.#streamID}-${this.#counter}`
  }

  #pushToBuffer(event: SSEEvent): void {
    if (this.#bufferCount < this.#bufferSize) {
      this.#buffer[(this.#bufferStart + this.#bufferCount) % this.#bufferSize] = event
      this.#bufferCount++
    } else {
      this.#buffer[this.#bufferStart] = event
      this.#bufferStart = (this.#bufferStart + 1) % this.#bufferSize
    }
  }

  async writePrimingEvent(): Promise<void> {
    if (this.#closed) return
    const id = this.#nextID()
    const event: SSEEvent = { id, data: '' }
    // Priming events carry no payload and are not recorded in the session
    // replay index (no #onEvent) — they exist only to open the stream.
    this.#pushToBuffer(event)
    await this.#writer.write(`id: ${id}\ndata: \n\n`)
  }

  async writeEvent(params: { data: string }): Promise<void> {
    if (this.#closed) return
    const id = this.#nextID()
    const event: SSEEvent = { id, data: params.data }
    this.#pushToBuffer(event)
    this.#onEvent?.(event)
    await this.#writer.write(`id: ${id}\ndata: ${params.data}\n\n`)
  }

  /**
   * Replay a previously-recorded event onto this stream, preserving its
   * original id. Does not buffer it or record it in the session replay
   * index — the event already lives there under its original id.
   */
  async writeRawEvent(event: SSEEvent): Promise<void> {
    if (this.#closed) return
    await this.#writer.write(`id: ${event.id}\ndata: ${event.data}\n\n`)
  }

  async writeRetry(ms: number): Promise<void> {
    if (this.#closed) return
    await this.#writer.write(`retry: ${ms}\n\n`)
  }

  getEventsAfter(lastEventID: string): Array<SSEEvent> {
    const events = this.#getBufferedEvents()
    const index = events.findIndex((e) => e.id === lastEventID)
    if (index === -1) {
      return events
    }
    return events.slice(index + 1)
  }

  #getBufferedEvents(): Array<SSEEvent> {
    const result: Array<SSEEvent> = []
    for (let i = 0; i < this.#bufferCount; i++) {
      result.push(this.#buffer[(this.#bufferStart + i) % this.#bufferSize])
    }
    return result
  }

  /**
   * Closes the underlying stream. Synchronous by design — every caller is a teardown path with
   * nothing left to await on — which makes the returned promise nobody's to handle.
   *
   * Hence the `catch`. `close()` on an already-errored writable rejects, and every route here is
   * a route that reaches this method precisely because something went wrong: a client that hung
   * up mid-stream, a sink that threw after its response was settled. Without it, closing a
   * faulted stream raises an unhandled rejection in the server process — a crash under Node's
   * default `--unhandled-rejections=throw`, from cleanup code whose failure has nobody to report
   * to and nothing to retry.
   */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    void this.#writer.close().catch(() => {
      // The stream is already gone; that is the only reason this can reject.
    })
  }
}
