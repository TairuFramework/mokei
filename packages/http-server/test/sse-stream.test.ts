import { describe, expect, test } from 'vitest'

import { createSSEStream } from '../src/sse-stream.js'
import { SSEWriter } from '../src/sse-writer.js'

const decoder = new TextDecoder()

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createSSEStream', () => {
  test('encodes written strings as UTF-8 chunks in order', async () => {
    const { readable, writable } = createSSEStream()
    const writer = writable.getWriter()
    const reader = readable.getReader()

    await writer.write('id: 1\ndata: a\n\n')
    await writer.write('id: 2\ndata: b\n\n')

    const first = await reader.read()
    const second = await reader.read()

    expect(first.value).toBeInstanceOf(Uint8Array)
    expect(decoder.decode(first.value)).toBe('id: 1\ndata: a\n\n')
    expect(decoder.decode(second.value)).toBe('id: 2\ndata: b\n\n')
  })

  test('applies backpressure when the reader stops consuming', async () => {
    const { writable } = createSSEStream()
    const writer = writable.getWriter()

    let resolved = 0
    for (let i = 0; i < 500; i++) {
      void writer.write(`data: ${i}\n\n`).then(() => {
        resolved++
      })
    }
    await tick()

    // With backpressure, only a bounded prefix resolves while nothing is read;
    // the rest park until the reader drains. Without it, all 500 resolve at once.
    expect(resolved).toBeGreaterThan(0)
    expect(resolved).toBeLessThan(500)
  })

  test('writes after the reader cancels resolve as no-ops instead of rejecting', async () => {
    const { readable, writable } = createSSEStream()
    const writer = writable.getWriter()
    const reader = readable.getReader()

    await writer.write('id: 1\ndata: a\n\n')
    await reader.cancel()

    // A client disconnect cancels the readable. A retained writer (a session GET stream, a
    // pending POST stream) may still be written to afterwards; that write must be a no-op, not a
    // rejection that errors the server's outbound transport and skips stream cleanup.
    await expect(writer.write('id: 2\ndata: b\n\n')).resolves.toBeUndefined()
  })

  test('SSEWriter.close() releases a write parked on backpressure instead of wedging', async () => {
    const { readable, writable, release } = createSSEStream()
    const writer = new SSEWriter({ writable, streamID: 'teardown', replayBufferSize: 100, release })

    // Never read `readable`. Push far more than the high-water mark so a sink write parks.
    const writes: Array<Promise<void>> = []
    for (let i = 0; i < 40; i++) {
      writes.push(writer.writeRawEvent({ id: `e${i}`, data: `${i}` }))
    }
    await tick()
    void readable // held only so the pair is not GC-eligible mid-test

    // Teardown (session deleted / handler disposed / replacement GET) must not hang behind the
    // parked write, which no reader pull or cancel will ever wake.
    writer.close()

    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500))
    const outcome = await Promise.race([
      Promise.allSettled(writes).then(() => 'settled' as const),
      timeout,
    ])
    expect(outcome).toBe('settled')
  })

  test('draining the reader resumes parked writes without loss or reordering', async () => {
    const { readable, writable } = createSSEStream()
    const writer = writable.getWriter()
    const reader = readable.getReader()

    const total = 200
    const writes: Array<Promise<void>> = []
    for (let i = 0; i < total; i++) {
      writes.push(writer.write(`data: ${i}\n\n`))
    }
    void writer.close()

    const received: Array<string> = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received.push(decoder.decode(value))
    }
    await Promise.all(writes)

    expect(received).toHaveLength(total)
    expect(received[0]).toBe('data: 0\n\n')
    expect(received[total - 1]).toBe(`data: ${total - 1}\n\n`)
  })
})
