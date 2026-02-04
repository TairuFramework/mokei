export type SSEEvent = {
  id: string
  data: string
}

export type SSEWriterParams = {
  writable: WritableStream<string>
  streamID: string
  replayBufferSize: number
}

export class SSEWriter {
  #writer: WritableStreamDefaultWriter<string>
  #streamID: string
  #counter = 0
  #buffer: Array<SSEEvent>
  #bufferSize: number
  #bufferStart = 0
  #bufferCount = 0

  constructor(params: SSEWriterParams) {
    this.#writer = params.writable.getWriter()
    this.#streamID = params.streamID
    this.#bufferSize = params.replayBufferSize
    this.#buffer = new Array<SSEEvent>(params.replayBufferSize)
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
    const id = this.#nextID()
    const event: SSEEvent = { id, data: '' }
    this.#pushToBuffer(event)
    await this.#writer.write(`id: ${id}\ndata: \n\n`)
  }

  async writeEvent(params: { data: string }): Promise<void> {
    const id = this.#nextID()
    const event: SSEEvent = { id, data: params.data }
    this.#pushToBuffer(event)
    await this.#writer.write(`id: ${id}\ndata: ${params.data}\n\n`)
  }

  async writeRetry(ms: number): Promise<void> {
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

  close(): void {
    this.#writer.close()
  }
}
