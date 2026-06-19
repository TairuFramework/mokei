import { describe, expect, test } from 'vitest'

import { wireMonitorStreams } from '../src/pipes.js'

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
