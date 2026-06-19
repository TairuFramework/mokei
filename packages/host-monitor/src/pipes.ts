export type MonitorPipes = {
  done: Promise<void>
  dispose: () => Promise<void>
}

export type WireMonitorStreamsParams = {
  socketReadable: ReadableStream<unknown>
  socketWritable: WritableStream<unknown>
  bridgeReadable: ReadableStream<unknown>
  bridgeWritable: WritableStream<unknown>
}

/**
 * Wire the daemon socket and the HTTP server bridge together. Teardown is
 * abort-driven (never `.close()` on a writable locked by an active `pipeTo`),
 * and the combined promise carries its own rejection handler so a daemon
 * disconnect surfaces as a settled `done`, not an unhandled rejection.
 */
export function wireMonitorStreams(params: WireMonitorStreamsParams): MonitorPipes {
  const controller = new AbortController()
  // Daemon disconnect / abort must not crash the process.
  const done = Promise.all([
    params.socketReadable.pipeTo(params.bridgeWritable, { signal: controller.signal }),
    params.bridgeReadable.pipeTo(params.socketWritable, { signal: controller.signal }),
  ])
    .then(() => {})
    .catch(() => {})

  return {
    done,
    dispose: async () => {
      controller.abort()
      await done
    },
  }
}
