import { createRemoteFlowControl, type FlowControl } from '@mokei/flow-client'
import { createClient, type HostClient } from '@mokei/host-node'

import { ensureMokeiDaemon } from './daemon.js'

export type FlowControlConnection = {
  control: FlowControl
  client: HostClient
  dispose: () => Promise<void>
}

/**
 * Connects to the host daemon and wraps it as a `FlowControl`. With `autoStart` the daemon is
 * spawned when absent; without it a missing daemon rejects and nothing is spawned.
 */
export async function connectFlowControl(options: {
  socketPath?: string
  autoStart: boolean
}): Promise<FlowControlConnection> {
  const client = options.autoStart
    ? await ensureMokeiDaemon({ socketPath: options.socketPath })
    : await createClient(options.socketPath)
  return {
    control: createRemoteFlowControl(client),
    client,
    dispose: async () => {
      await client.dispose()
    },
  }
}

/**
 * Runs `work` with a signal aborted by SIGINT or SIGTERM. The listeners are removed once the work
 * settles, so the process regains default signal behaviour.
 */
export async function withCommandSignal<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    return await work(controller.signal)
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}
