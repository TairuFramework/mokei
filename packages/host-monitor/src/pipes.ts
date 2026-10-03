export type MonitorPipes = {
  done: Promise<void>
  dispose: () => Promise<void>
}

export type WireMonitorStreamsParams = {
  socketReadable: ReadableStream<unknown>
  socketWritable: WritableStream<unknown>
  bridgeReadable: ReadableStream<unknown>
  bridgeWritable: WritableStream<unknown>
  filter?: (message: unknown) => { forward: unknown } | { reply: unknown }
  injected?: ReadableStream<unknown>
}

/**
 * Wire the daemon socket and the HTTP server bridge together. Teardown is
 * abort-driven (never `.close()` on a writable locked by an active `pipeTo`),
 * and the combined promise carries its own rejection handler so a daemon
 * disconnect surfaces as a settled `done`, not an unhandled rejection.
 */
export function wireMonitorStreams(params: WireMonitorStreamsParams): MonitorPipes {
  const controller = new AbortController()
  // One writer per destination serialises daemon traffic and locally generated messages.
  const socketWriter = params.socketWritable.getWriter()
  const bridgeWriter = params.bridgeWritable.getWriter()
  let destinationCleanup: Promise<unknown> | undefined
  controller.signal.addEventListener(
    'abort',
    () => {
      destinationCleanup = Promise.all([
        socketWriter.abort().catch(() => {}),
        bridgeWriter.abort().catch(() => {}),
      ])
    },
    { once: true },
  )

  const pipe = (readable: ReadableStream<unknown>, write: (message: unknown) => Promise<void>) => {
    return readable
      .pipeTo(new WritableStream({ write }), { signal: controller.signal })
      .catch(() => {
        controller.abort()
      })
  }
  const pending = [
    pipe(params.socketReadable, (message) => bridgeWriter.write(message)).then(() => {
      controller.abort()
    }),
    pipe(params.bridgeReadable, (message) => {
      const filtered = params.filter?.(message) ?? { forward: message }
      return 'reply' in filtered
        ? bridgeWriter.write(filtered.reply)
        : socketWriter.write(filtered.forward)
    }),
  ]
  if (params.injected != null) {
    pending.push(pipe(params.injected, (message) => socketWriter.write(message)))
  }
  const done = Promise.all(pending).then(async () => {
    await destinationCleanup
    socketWriter.releaseLock()
    bridgeWriter.releaseLock()
  })

  return {
    done,
    dispose: async () => {
      controller.abort()
      await done
    },
  }
}

type BrowserMessage = {
  header: unknown
  payload: { typ: string; prc?: string; rid: string; prm?: Record<string, unknown> }
}

export function createMonitorFilter(
  getAttachmentID: () => string = () => '',
): NonNullable<WireMonitorStreamsParams['filter']> {
  return (message) => {
    const msg = message as BrowserMessage
    const { payload } = msg
    if (payload.prc === 'monitor.attach') {
      return {
        reply: {
          header: {},
          payload: {
            typ: 'error',
            rid: payload.rid,
            code: 'FORBIDDEN',
            msg: 'Monitor attachment is reserved for the monitor process',
            data: {},
          },
        },
      }
    }
    if (payload.prc === 'monitor.presence' && payload.typ === 'channel') {
      return {
        forward: {
          ...msg,
          payload: {
            ...payload,
            prm: {
              ...payload.prm,
              attachmentID: getAttachmentID(),
            },
          },
        },
      }
    }
    return { forward: message }
  }
}
