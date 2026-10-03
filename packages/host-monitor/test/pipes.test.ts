import { describe, expect, test } from 'vitest'

import { createMonitorFilter, wireMonitorStreams } from '../src/pipes.js'

function passthrough() {
  return new TransformStream<unknown, unknown>()
}

describe('wireMonitorStreams', () => {
  test('does not crash when a source stream errors (daemon disconnect)', async () => {
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const socket = passthrough()
    const bridge = passthrough()

    const erroringReadable = new ReadableStream({
      start(controller) {
        controller.error(new Error('daemon disconnected'))
      },
    })

    const pipes = wireMonitorStreams({
      socketReadable: erroringReadable,
      socketWritable: socket.writable,
      bridgeReadable: bridge.readable,
      bridgeWritable: bridge.writable,
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toHaveLength(0)

    await pipes.dispose()
  })

  test('daemon EOF settles done after destination cleanup and releases writer locks', async () => {
    const cancelled: Array<string> = []
    const aborted: Array<string> = []
    const cleanup = Promise.withResolvers<void>()
    const socketWritable = new WritableStream({
      async abort() {
        await cleanup.promise
        aborted.push('socket')
      },
    })
    const bridgeWritable = new WritableStream({
      async abort() {
        await cleanup.promise
        aborted.push('bridge')
      },
    })
    const pipes = wireMonitorStreams({
      socketReadable: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
      socketWritable,
      bridgeReadable: new ReadableStream({
        cancel() {
          cancelled.push('bridge')
        },
      }),
      bridgeWritable,
      injected: new ReadableStream({
        cancel() {
          cancelled.push('injected')
        },
      }),
    })
    let settled = false
    void pipes.done.then(() => {
      settled = true
    })
    try {
      await expect.poll(() => cancelled.toSorted()).toEqual(['bridge', 'injected'])
      expect(settled).toBe(false)
      cleanup.resolve()
      await expect.poll(() => settled).toBe(true)
      expect(aborted.toSorted()).toEqual(['bridge', 'socket'])
      expect(socketWritable.locked).toBe(false)
      expect(bridgeWritable.locked).toBe(false)
      await expect(pipes.dispose()).resolves.toBeUndefined()
    } finally {
      cleanup.resolve()
      await pipes.dispose()
    }
  })

  test('dispose resolves while pipes are active (no close-on-locked-stream throw)', async () => {
    const socket = passthrough()
    const bridge = passthrough()

    const idleReadable = new ReadableStream({ start() {} }) // never closes

    const pipes = wireMonitorStreams({
      socketReadable: idleReadable,
      socketWritable: socket.writable,
      bridgeReadable: bridge.readable,
      bridgeWritable: bridge.writable,
    })

    await expect(pipes.dispose()).resolves.toBeUndefined()
  })
})

test('filters browser messages and merges injected messages and local replies', async () => {
  const sent: Array<unknown> = []
  const received: Array<unknown> = []
  const bridge = passthrough()
  const socket = passthrough()
  const injected = passthrough()
  const pipes = wireMonitorStreams({
    socketReadable: socket.readable,
    socketWritable: new WritableStream({
      write(value) {
        sent.push(value)
      },
    }),
    bridgeReadable: bridge.readable,
    bridgeWritable: new WritableStream({
      write(value) {
        received.push(value)
      },
    }),
    injected: injected.readable,
    filter: (message) =>
      message === 'reserved' ? { reply: 'forbidden' } : { forward: `${message}-stamped` },
  })
  try {
    const browserWriter = bridge.writable.getWriter()
    await browserWriter.write('reserved')
    await browserWriter.write('presence')
    await expect.poll(() => sent).toEqual(['presence-stamped'])
    await expect.poll(() => received).toEqual(['forbidden'])
    await injected.writable.getWriter().write('abort')
    await socket.writable.getWriter().write('daemon-reply')
    await expect.poll(() => sent).toEqual(['presence-stamped', 'abort'])
    await expect.poll(() => received).toEqual(['forbidden', 'daemon-reply'])
  } finally {
    await pipes.dispose()
  }
})

test('presence filtering reads the current attachment and preserves channel sends', () => {
  let attachmentID = 'attachment-one'
  const filter = createMonitorFilter(() => attachmentID)
  const open = {
    header: { trace: 'trace' },
    payload: {
      typ: 'channel',
      prc: 'monitor.presence',
      rid: 'presence',
      prm: { attachmentID: 'forged' },
    },
  }
  expect(filter(open)).toEqual({
    forward: {
      ...open,
      payload: {
        ...open.payload,
        prm: { attachmentID: 'attachment-one' },
      },
    },
  })
  attachmentID = 'attachment-two'
  expect(filter(open)).toEqual({
    forward: {
      ...open,
      payload: {
        ...open.payload,
        prm: { attachmentID: 'attachment-two' },
      },
    },
  })
  const send = {
    header: {},
    payload: { typ: 'send', prc: 'monitor.presence', rid: 'presence', val: { type: 'pong' } },
  }
  expect(filter(send)).toEqual({ forward: send })
  expect(open.payload.prm.attachmentID).toBe('forged')
})
