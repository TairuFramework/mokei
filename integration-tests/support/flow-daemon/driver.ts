import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import type { TaskRecord } from '@mokei/context-server'
import type { RunRecord, TraceStore } from '@mokei/flow-host'
import { createClient, type HostClient } from '@mokei/host-node'
import type { HostEvent } from '@mokei/host-protocol'
import { settleAll } from '@sozai/async'
import { getPIDPath } from '@tejika/env'
import { createTestProfile, poll } from '@tejika/test'

import { flows } from './flows.js'

const WAIT_MS = 15_000
const absolute = (path: string) => fileURLToPath(new URL(path, import.meta.url))
export type DesktopRecord = {
  pid: number
  type: string
  message?: string
  index?: number
  requestedSchema?: Record<string, unknown>
}
export type PromptAnswer = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}
type SiblingRecord = { pid: number; type: 'started' | 'echo'; value?: string }
export type FlowDaemonFixture = Awaited<ReturnType<typeof startFlowDaemonFixture>>

function records<T>(path: string): Array<T> {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}
function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

export async function startFlowDaemonFixture(
  options: {
    notifications?: boolean
    invalidConfig?: boolean
    productionEntry?: boolean
    otlp?: { endpoint: string }
  } = {},
) {
  const profile = createTestProfile('mokei', { baseDir: '/tmp' })
  const directory = profile.dir
  const socketPath = join(directory, 'daemon.sock')
  const env = {
    ...profile.env,
    MOKEI_LOG_DIR: join(directory, 'logs'),
    // Pin every path override so inherited MOKEI_* variables cannot escape the temp directory.
    MOKEI_PID_PATH: join(directory, 'mokei.pid'),
    MOKEI_SOCKET_PATH: socketPath,
  }
  // Resolve the pid file with the CLI's own call so the fixture and `mokei daemon` agree.
  const pidPath = withEnv(env, () => getPIDPath('mokei'))
  const databasePath = join(directory, 'mokei.db')
  const clients = new Set<HostClient>()
  const subscriptions = new Set<() => Promise<void>>()
  const children: Array<ChildProcess> = []
  let child: ChildProcess | undefined
  let stderr = ''
  let spawnError: Error | undefined
  let disposed = false
  const sibling = {
    command: process.execPath,
    args: [absolute('./sibling.mjs'), join(directory, 'sibling.jsonl')],
  }
  const desktopRecords = () => records<DesktopRecord>(join(directory, 'desktop.jsonl'))
  const siblingRecords = () => records<SiblingRecord>(join(directory, 'sibling.jsonl'))
  const diagnostics = () => {
    return `daemon pid=${child?.pid}, exit=${child?.exitCode}, signal=${child?.signalCode}\n${stderr}`
  }

  async function within<T>(label: string, operation: Promise<T>, timeout = WAIT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out during ${label}\n${diagnostics()}`)),
            timeout,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  async function wait<T>(label: string, check: () => T | Promise<T>): Promise<NonNullable<T>> {
    const deadline = Date.now() + WAIT_MS
    let last: unknown
    const result = await poll(
      async () => {
        if (Date.now() >= deadline) return undefined
        try {
          return await within(label, Promise.resolve().then(check), deadline - Date.now())
        } catch (error) {
          last = error
          return undefined
        }
      },
      { timeoutMs: WAIT_MS, intervalMs: 20 },
    )
    if (result) return result as NonNullable<T>
    throw new Error(`Timed out waiting for ${label}: ${String(last)}\n${diagnostics()}`, {
      cause: last,
    })
  }
  async function connect() {
    if (spawnError) throw spawnError
    const client = await within('socket connection', createClient(socketPath))
    clients.add(client)
    return client
  }
  async function closeClients() {
    const closing = [
      ...subscriptions,
      ...[...clients].map((client) => () => within('client disposal', client.dispose())),
    ]
    subscriptions.clear()
    clients.clear()
    await settleAll(closing, 'Client cleanup failed')
  }
  async function end(signal: NodeJS.Signals, expectedExitCode = 0) {
    if (child == null) return
    let clientError: unknown
    try {
      await closeClients()
    } catch (error) {
      clientError = error
    } finally {
      if (child.exitCode == null && child.signalCode == null) child.kill(signal)
    }
    await wait('daemon exit', () => child?.exitCode != null || child?.signalCode != null)
    if (signal === 'SIGTERM') {
      if (child.exitCode !== expectedExitCode)
        throw new Error(`Graceful shutdown failed: ${diagnostics()}`)
      if (existsSync(socketPath) || existsSync(pidPath))
        throw new Error(`Shutdown left socket or pidfile: ${diagnostics()}`)
    }
    await wait('sibling exit', () => siblingRecords().every(({ pid }) => !alive(pid)))
    child = undefined
    if (clientError) throw clientError
  }
  async function restart() {
    if (child != null) throw new Error('Stop the existing daemon before replacement')
    spawnError = undefined
    const args = options.productionEntry
      ? [
          absolute('../../../packages/cli/lib/daemon-entry.js'),
          '--socket-path',
          socketPath,
          '--pid-path',
          pidPath,
          '--config-path',
          join(directory, 'mokei.json'),
          '--flows-config-path',
          join(directory, 'flows.json'),
          '--database-path',
          databasePath,
        ]
      : [absolute('./entry.mjs'), directory]
    child = spawn(process.execPath, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, ...env },
    })
    children.push(child)
    child.once('error', (error) => {
      spawnError = error
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const client = await wait('daemon socket', () => connect())
    const info = await wait('flow service startup', async () => {
      const info = await client.request('info', { timeout: 1000 })
      return info.flowService.state !== 'starting' ? info : undefined
    })
    const expected = options.invalidConfig ? 'failed' : 'ready'
    if (info.flowService.state !== expected)
      throw new Error(
        `Unexpected flow status: ${JSON.stringify(info.flowService)}\n${diagnostics()}`,
      )
  }
  async function dispose() {
    if (disposed) return
    disposed = true
    const errors: Array<unknown> = []
    const attempt = async (work: () => Promise<unknown>) => {
      try {
        await work()
      } catch (error) {
        errors.push(error)
      }
    }
    await attempt(() => end('SIGTERM'))
    await attempt(closeClients)
    for (const process of children) {
      if (process.exitCode == null && process.signalCode == null) process.kill('SIGKILL')
    }
    const pids = new Set([
      ...children.flatMap((process) => (process.pid == null ? [] : [process.pid])),
      ...siblingRecords().map(({ pid }) => pid),
    ])
    for (const pid of pids) {
      try {
        if (alive(pid)) process.kill(pid, 'SIGKILL')
      } catch (error) {
        errors.push(error)
      }
    }
    await attempt(() =>
      wait('all fixture processes reaped', () => [...pids].every((pid) => !alive(pid))),
    )
    await attempt(async () => {
      await profile[Symbol.asyncDispose]()
    })
    if (existsSync(socketPath)) errors.push(new Error('Fixture socket survived cleanup'))
    if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed')
  }

  const fixture = {
    directory,
    socketPath,
    pidPath,
    env,
    sibling,
    connect,
    wait,
    within,
    restart,
    dispose,
    diagnostics,
    stop: (expectedExitCode = 0) => end('SIGTERM', expectedExitCode),
    kill: () => end('SIGKILL'),
    desktopRecords,
    siblingRecords,
    notifications: () =>
      desktopRecords().flatMap((record) =>
        record.type === 'notification' && record.message != null ? [record.message] : [],
      ),
    readDatabase() {
      // This isolated reader sees committed WAL records and never migrates or writes the database.
      const db = new DatabaseSync(databasePath, { readOnly: true })
      try {
        db.exec('BEGIN')
        return {
          runs: db
            .prepare('SELECT data FROM mokei_flow_runs ORDER BY seq')
            .all()
            .map((row) => JSON.parse(row.data as string) as RunRecord),
          tasks: db
            .prepare('SELECT data FROM mokei_flow_tasks ORDER BY seq')
            .all()
            .map((row) => JSON.parse(row.data as string) as TaskRecord),
        }
      } finally {
        db.close()
      }
    },
    async readTrace(traceID: string): ReturnType<TraceStore['getTrace']> {
      // Raw read-only SQL keeps the reader from ever migrating or writing the database.
      const db = new DatabaseSync(databasePath, { readOnly: true })
      try {
        const read = (sql: string) =>
          db
            .prepare(sql)
            .all(traceID)
            .map((row) => JSON.parse(row.data as string))
        return {
          spans: read('SELECT data FROM mokei_spans WHERE trace_id = ? ORDER BY start_time, seq'),
          logs: read('SELECT data FROM mokei_logs WHERE trace_id = ? ORDER BY timestamp, seq'),
        }
      } finally {
        db.close()
      }
    },
    pending(client: HostClient, runID: string) {
      return wait(
        'pending input or approval',
        async () => (await client.request('inbox.list', { param: { runID }, timeout: 1000 }))[0],
      )
    },
    terminal(client: HostClient, runID: string) {
      return wait('terminal run', async () => {
        const run = await client.request('runs.get', { param: { runID }, timeout: 1000 })
        return ['completed', 'failed', 'cancelled', 'denied'].includes(run.state) ? run : undefined
      })
    },
    async subscribe(client: HostClient) {
      const events: Array<HostEvent> = []
      const stream = client.createStream('events')
      void stream.catch(() => {})
      const reading = (async () => {
        for await (const event of stream.readable) events.push(event)
      })()
      void reading.catch(() => {})
      const close = async () => {
        stream.close()
        subscriptions.delete(close)
        await within(
          'subscriber disposal',
          reading.catch(() => {}),
        )
      }
      subscriptions.add(close)
      // The info response follows event-handler registration on this connection.
      await client.request('info', { timeout: 1000 })
      return { events, close }
    },
    async answerPrompt(index: number, result: PromptAnswer) {
      if (child == null) throw new Error('No running daemon')
      child.send({ type: 'answer', index, action: result.action, content: result.content })
      await wait('native prompt completion', () =>
        desktopRecords().some(
          (record) =>
            record.pid === child?.pid && record.type === 'resolved' && record.index === index,
        ),
      )
    },
  }
  try {
    await mkdir(join(directory, 'flows'))
    for (const flow of flows)
      await writeFile(join(directory, 'flows', `${flow.id}.json`), JSON.stringify(flow))
    await writeFile(
      join(directory, 'mokei.json'),
      JSON.stringify({
        logs: { level: 'debug' },
        ...(options.otlp ? { tracing: { otlp: options.otlp } } : {}),
      }),
    )
    await writeFile(
      join(directory, 'flows.json'),
      options.invalidConfig
        ? '{invalid'
        : JSON.stringify({
            flowDirs: ['./flows'],
            siblings: { sibling },
            ...(options.notifications == null
              ? {}
              : { desktop: { notifications: options.notifications } }),
          }),
    )
    await restart()
    return fixture
  } catch (error) {
    await dispose().catch((cleanupError: unknown) => {
      throw new AggregateError([error, cleanupError], 'Fixture startup and cleanup failed')
    })
    throw error
  }
}
