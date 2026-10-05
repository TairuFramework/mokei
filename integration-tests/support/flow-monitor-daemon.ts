import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type HostClient } from '@mokei/host-node'
import { poll } from '@tejika/test'
import { vi } from 'vitest'

import { flows } from './flow-daemon/flows.js'

export async function startFlowMonitorDaemon() {
  const directory = await mkdtemp('/tmp/mokei-flow-monitor-')
  const socketPath = join(directory, 'daemon.sock')
  const clients = new Set<HostClient>()
  const children: Array<ChildProcess> = []
  let child: ChildProcess | undefined
  let stderr = ''
  const notify = vi.fn((_message: string, _options: { onClick(): void }) => {})
  const prompt = vi.fn(() => {})
  const openURL = vi.fn((_url: string) => {})
  async function wait<T>(label: string, check: () => T | Promise<T>): Promise<NonNullable<T>> {
    const deadline = Date.now() + 15_000
    let last: unknown
    const exited = Symbol('daemon exited')
    const result = await poll(
      async () => {
        if (Date.now() >= deadline) return undefined
        try {
          const value = await check()
          if (value) return value
        } catch (error) {
          last = error
        }
        if (child?.exitCode != null || child?.signalCode != null) return exited
        return undefined
      },
      { timeoutMs: 15_000, intervalMs: 20 },
    )
    if (result && result !== exited) return result as NonNullable<T>
    throw new Error(`Failed waiting for ${label}: ${String(last)}\n${stderr}`, { cause: last })
  }
  async function connect() {
    const client = await createClient(socketPath)
    clients.add(client)
    return client
  }
  async function start() {
    stderr = ''
    const current = spawn(
      process.execPath,
      [fileURLToPath(new URL('./flow-monitor-entry.mjs', import.meta.url)), directory],
      {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: {
          ...process.env,
          MOKEI_DATA_DIR: directory,
          MOKEI_STATE_DIR: directory,
          MOKEI_LOG_DIR: join(directory, 'logs'),
          MOKEI_SOCKET_PATH: socketPath,
          MOKEI_PID_PATH: join(directory, 'daemon.pid'),
        },
      },
    )
    children.push(current)
    child = current
    current.on('error', (error) => {
      stderr += String(error)
    })
    current.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    current.on(
      'message',
      (message: { type: string; index: number; message: string; url: string }) => {
        if (message.type === 'notification')
          notify(message.message, {
            onClick: () => {
              current.send({ type: 'click', index: message.index })
            },
          })
        else if (message.type === 'prompt') prompt()
        else if (message.type === 'open') openURL(message.url)
      },
    )
    const client = await wait('daemon socket', connect)
    const info = await wait('flow service startup', async () => {
      const info = await client.request('info', { timeout: 1000 })
      return info.flowService.state !== 'starting' ? info : undefined
    })
    if (info.flowService.state !== 'ready')
      throw new Error(`Flow startup failed: ${JSON.stringify(info)}\n${stderr}`)
    return client
  }
  async function stop() {
    const current = child
    const results = await Promise.allSettled([...clients].map((client) => client.dispose()))
    clients.clear()
    if (current != null && current.exitCode == null && current.signalCode == null)
      current.kill('SIGTERM')
    // Exiting is expected here, so wait independently of the startup liveness check.
    await poll(() => current == null || current.exitCode != null || current.signalCode != null, {
      timeoutMs: 15_000,
      intervalMs: 20,
    })
    if (current != null && current.exitCode == null && current.signalCode == null)
      throw new Error(`Daemon failed to stop\n${stderr}`)
    child = undefined
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length) throw new AggregateError(failures, 'Client cleanup failed')
    if (current != null && current.exitCode !== 0)
      throw new Error(`Daemon exit ${current.exitCode}/${current.signalCode}\n${stderr}`)
  }
  async function dispose() {
    try {
      await stop()
    } finally {
      for (const current of children) {
        if (current.exitCode == null && current.signalCode == null) {
          const exited = new Promise<void>((resolve) => current.once('exit', () => resolve()))
          current.kill('SIGKILL')
          await exited
        }
      }
      await rm(directory, { recursive: true, force: true })
    }
  }
  try {
    const flowDir = join(directory, 'flows')
    await mkdir(flowDir)
    await writeFile(join(flowDir, 'input.json'), JSON.stringify(flows[0]))
    await writeFile(
      join(directory, 'flows.json'),
      JSON.stringify({ flowDirs: [flowDir], desktop: { notifications: true } }),
    )
    const client = await start()
    return {
      socketPath,
      client,
      notify,
      prompt,
      openURL,
      dispose,
      connect,
      async restart() {
        await stop()
        return start()
      },
    }
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      // biome-ignore lint/style/useErrorCause: AggregateError takes cause in its third argument.
      throw new AggregateError([error, cleanupError], 'Daemon setup and cleanup failed', {
        cause: error,
      })
    }
    throw error
  }
}
