import { createRemoteFlowControl, type FlowControl } from '@mokei/flow-client'
import { createClient, type HostClient } from '@mokei/host-node'

import { ensureMokeiDaemon } from './daemon.js'

export { withCommandSignal } from '@tejika/cli'

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
