import type { FlowControl } from '@mokei/flow-client'

import { connectFlowControl } from './flow-control.js'

/** Runs `work` on a connection that auto-starts the daemon and is always disposed. */
export async function withControl<T>(
  socketPath: string,
  work: (control: FlowControl) => Promise<T>,
): Promise<T> {
  const connection = await connectFlowControl({ socketPath, autoStart: true })
  try {
    return await work(connection.control)
  } finally {
    await connection.dispose()
  }
}
