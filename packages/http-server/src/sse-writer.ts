import { getMokeiLogger, type Logger } from '@mokei/logger'

export type SSEEvent = {
  id: string
  data: string
}

export type SSEWriterParams = {
  writable: WritableStream<string>
  streamID: string
  replayBufferSize: number
  onEvent?: (event: SSEEvent) => void
  /** Optional logger (defaults to the `mokei:http-server` logger) */
  logger?: Logger
  /**
   * Optional teardown hook from {@link createSSEStream}, called by {@link close} to release a
   * write parked on backpressure so closing does not wedge behind it.
   */
  release?: () => void
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
  #logger: Logger
  #release: (() => void) | undefined
  // While set, live events ({@link writeEvent}) wait on this before writing. A resuming GET
  // stream is published to the session before its replay snapshot finishes; the gate holds any
  // live server message that arrives in that window so it lands after the replay, never
  // interleaved into it and never dropped.
  #liveGate: Promise<void> | undefined

  constructor(params: SSEWriterParams) {
    this.#writer = params.writable.getWriter()
    this.#streamID = params.streamID
    this.#bufferSize = params.replayBufferSize
    this.#buffer = new Array<SSEEvent>(params.replayBufferSize)
    this.#onEvent = params.onEvent
    this.#logger = params.logger ?? getMokeiLogger('http-server')
    this.#release = params.release
  }

  get streamID(): string {
    return this.#streamID
  }

  /**
   * Hold back live events ({@link writeEvent}) until `gate` settles, without holding back priming
   * or replay ({@link writeRawEvent}) writes. Lets a resuming GET stream be published to the
   * session up front — so it closes a superseding GET and receives (rather than drops) live
   * traffic — while still ordering that traffic after the replay snapshot. The gate's rejection is
   * swallowed: a failed replay releases live traffic rather than wedging the stream.
   */
  deferLiveWritesUntil(gate: Promise<unknown>): void {
    this.#liveGate = gate.then(
      () => {},
      () => {},
    )
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
    // Assign the id and record the event (replay buffer + session replay index) BEFORE the gate.
    // A resuming GET publishes its stream and gates live writes until its replay snapshot is
    // written; if that stream is superseded and closed while this write is still gated, its wire
    // delivery is dropped. Recording here keeps the event recoverable by a later resumption
    // regardless. The id is fixed now so the wire frame (if it lands) matches the recorded entry.
    const id = this.#nextID()
    const event: SSEEvent = { id, data: params.data }
    this.#pushToBuffer(event)
    this.#onEvent?.(event)
    if (this.#liveGate != null) {
      await this.#liveGate
      if (this.#closed) return
    }
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
   * to and nothing to retry. The rejection is logged rather than swallowed outright, so a
   * genuinely diagnosable stream fault does not vanish.
   */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    // Release a write parked on backpressure first, so `writer.close()` is not serialized behind
    // one that no reader will ever wake.
    this.#release?.()
    void this.#writer.close().catch((error: unknown) => {
      this.#logger.warn('Failed to close SSE stream', {
        streamID: this.#streamID,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}
