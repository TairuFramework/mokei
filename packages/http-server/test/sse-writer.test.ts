import { describe, expect, test } from 'vitest'

import { SSEWriter } from '../src/sse-writer.js'

function createWritableAndChunks(): {
  writable: WritableStream<string>
  chunks: Array<string>
} {
  const chunks: Array<string> = []
  const writable = new WritableStream<string>({
    write(chunk) {
      chunks.push(chunk)
    },
  })
  return { writable, chunks }
}

describe('SSEWriter', () => {
  test('formats and writes SSE events to a stream', async () => {
    const { writable, chunks } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-1',
      replayBufferSize: 10,
    })

    await writer.writeEvent({ data: '{"jsonrpc":"2.0","id":1}' })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('id: stream-1-1\ndata: {"jsonrpc":"2.0","id":1}\n\n')

    writer.close()
  })

  test('sends initial priming event with empty data', async () => {
    const { writable, chunks } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-2',
      replayBufferSize: 10,
    })

    await writer.writePrimingEvent()

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('id: stream-2-1\ndata: \n\n')

    writer.close()
  })

  test('buffers events for replay', async () => {
    const { writable } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-3',
      replayBufferSize: 10,
    })

    await writer.writeEvent({ data: 'msg1' })
    await writer.writeEvent({ data: 'msg2' })
    await writer.writeEvent({ data: 'msg3' })

    const events = writer.getEventsAfter('stream-3-1')
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ id: 'stream-3-2', data: 'msg2' })
    expect(events[1]).toEqual({ id: 'stream-3-3', data: 'msg3' })

    writer.close()
  })

  test('getEventsAfter returns events after the given ID', async () => {
    const { writable } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-4',
      replayBufferSize: 10,
    })

    await writer.writeEvent({ data: 'a' })
    await writer.writeEvent({ data: 'b' })
    await writer.writeEvent({ data: 'c' })
    await writer.writeEvent({ data: 'd' })

    const events = writer.getEventsAfter('stream-4-2')
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ id: 'stream-4-3', data: 'c' })
    expect(events[1]).toEqual({ id: 'stream-4-4', data: 'd' })

    writer.close()
  })

  test('getEventsAfter returns all events when ID not found', async () => {
    const { writable } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-5',
      replayBufferSize: 10,
    })

    await writer.writeEvent({ data: 'x' })
    await writer.writeEvent({ data: 'y' })

    const events = writer.getEventsAfter('unknown-id')
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ id: 'stream-5-1', data: 'x' })
    expect(events[1]).toEqual({ id: 'stream-5-2', data: 'y' })

    writer.close()
  })

  test('ring buffer evicts oldest events when full', async () => {
    const { writable } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-6',
      replayBufferSize: 3,
    })

    await writer.writeEvent({ data: 'e1' })
    await writer.writeEvent({ data: 'e2' })
    await writer.writeEvent({ data: 'e3' })
    await writer.writeEvent({ data: 'e4' })
    await writer.writeEvent({ data: 'e5' })

    // Buffer size is 3, so only last 3 events should remain
    const events = writer.getEventsAfter('nonexistent')
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ id: 'stream-6-3', data: 'e3' })
    expect(events[1]).toEqual({ id: 'stream-6-4', data: 'e4' })
    expect(events[2]).toEqual({ id: 'stream-6-5', data: 'e5' })

    writer.close()
  })

  test('writes retry field', async () => {
    const { writable, chunks } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'stream-7',
      replayBufferSize: 10,
    })

    await writer.writeRetry(5000)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('retry: 5000\n\n')

    writer.close()
  })

  test('exposes streamID', () => {
    const { writable } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 'my-stream',
      replayBufferSize: 10,
    })

    expect(writer.streamID).toBe('my-stream')

    writer.close()
  })

  test('increments event IDs across different event types', async () => {
    const { writable, chunks } = createWritableAndChunks()
    const writer = new SSEWriter({
      writable,
      streamID: 's',
      replayBufferSize: 10,
    })

    await writer.writePrimingEvent()
    await writer.writeEvent({ data: 'hello' })
    await writer.writeEvent({ data: 'world' })

    expect(chunks[0]).toContain('id: s-1')
    expect(chunks[1]).toContain('id: s-2')
    expect(chunks[2]).toContain('id: s-3')

    writer.close()
  })
})
