import { rmSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { connectSocket } from '@enkaku/socket'

/** True if something is actively listening on the socket (not just a stale file). */
export async function isSocketLive(socketPath: string): Promise<boolean> {
  try {
    const socket = await connectSocket(socketPath)
    socket.destroy()
    return true
  } catch {
    return false
  }
}

export type WaitForSocketOptions = { timeout?: number; interval?: number }

/** Poll until the socket accepts a connection, or reject after `timeout` ms. */
export async function waitForSocket(
  socketPath: string,
  options: WaitForSocketOptions = {},
): Promise<void> {
  const timeout = options.timeout ?? 3000
  const interval = options.interval ?? 50
  const deadline = Date.now() + timeout
  for (;;) {
    if (await isSocketLive(socketPath)) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for socket ${socketPath}`)
    }
    await delay(interval)
  }
}

/** Remove a socket file, tolerating concurrent removal (ENOENT). */
export function safeRemove(socketPath: string): void {
  try {
    rmSync(socketPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}
