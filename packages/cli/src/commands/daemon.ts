import { type FSWatcher, watch } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FlowServiceStatus } from '@mokei/host-protocol'
import { getLogDir, getPIDPath } from '@tejika/env'
import { getDaemonStatus, stopDaemon } from '@tejika/process'
import { Command } from 'commander'

import { connectFlowControl, withCommandSignal } from '../flow-control.js'
import { withSocketPath } from '../options.js'
import { addJSONOption, fail, printJSON } from '../output.js'

const APP = 'mokei'
const STOP_KILL_TIMEOUT_MS = 75_000
const START_TIMEOUT_MS = 30_000
const START_POLL_MS = 100
const DEFAULT_LOG_LINES = 50

export type DaemonIdentity = {
  state: 'not-running' | 'stale' | 'booting' | 'running'
  pid?: number
  otherSocketPath?: string
}

/**
 * Identifies the daemon by its pid file, which records the socket path it serves. A daemon
 * serving a different socket than the selected one is reported as `not-running` for the selected
 * socket, with the other path named.
 */
export async function resolveDaemonIdentity(socketPath: string): Promise<DaemonIdentity> {
  const status = await getDaemonStatus({ app: APP, pidPath: getPIDPath(APP) })
  if (status.state === 'not-running') return { state: 'not-running' }
  if (status.state === 'stale') return { state: 'stale', pid: status.pid }
  if (status.socketPath !== socketPath) {
    return { state: 'not-running', otherSocketPath: status.socketPath }
  }
  return {
    state: status.state === 'booting' ? 'booting' : 'running',
    pid: status.pid,
  }
}

function mismatchMessage(socketPath: string, other: string): string {
  return `The daemon serves ${other}, not the selected socket ${socketPath}`
}

type CommandOptions = { socketPath: string; json?: boolean }

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

type StartResult = { pid?: number; socketPath: string; flowService: FlowServiceStatus }
type Outcome<T> = { ok: true; value: T } | { ok: false; message: string; value?: T }

/** Rejects when the signal aborts or the deadline passes, even if `work` never settles. */
function bounded<T>(work: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('Interrupted while waiting for the flow service'))
    }
    const timer = setTimeout(
      () => {
        cleanup()
        reject(new Error(`The flow service is still starting after ${START_TIMEOUT_MS / 1000}s`))
      },
      Math.max(0, deadline - Date.now()),
    )
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function runStart(socketPath: string): Promise<Outcome<StartResult>> {
  return await withCommandSignal(async (signal) => {
    const deadline = Date.now() + START_TIMEOUT_MS
    const connection = await connectFlowControl({ socketPath, autoStart: true })
    try {
      let info = await bounded(connection.client.request('info'), signal, deadline)
      while (info.flowService.state === 'starting') {
        await bounded(sleep(START_POLL_MS, signal), signal, deadline)
        info = await bounded(connection.client.request('info'), signal, deadline)
      }
      const identity = await resolveDaemonIdentity(socketPath)
      const value = { pid: identity.pid, socketPath, flowService: info.flowService }
      if (info.flowService.state === 'failed') {
        const { message, issues = [] } = info.flowService.error
        const lines = [`Flow service failed: ${message}`, ...issues.map((issue) => `  ${issue}`)]
        return { ok: false, message: lines.join('\n'), value }
      }
      return { ok: true, value }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally {
      await connection.dispose()
    }
  })
}

function reportStart(outcome: Outcome<StartResult>, json: boolean | undefined): void {
  if (json && outcome.value != null) printJSON(outcome.value)
  if (!outcome.ok) {
    fail(outcome.message)
    return
  }
  if (!json) {
    const { pid, socketPath, flowService } = outcome.value
    process.stdout.write(
      `daemon running (pid ${pid ?? 'unknown'})\nsocket: ${socketPath}\nflow service: ${flowService.state}\n`,
    )
  }
}

type StopOutcome =
  | { outcome: 'stopped'; pid?: number }
  | { outcome: 'not-running' }
  | { outcome: 'failed'; message: string }

async function runStop(socketPath: string): Promise<StopOutcome> {
  const identity = await resolveDaemonIdentity(socketPath)
  if (identity.otherSocketPath != null) {
    return { outcome: 'failed', message: mismatchMessage(socketPath, identity.otherSocketPath) }
  }
  const result = await stopDaemon({
    app: APP,
    pidPath: getPIDPath(APP),
    waitForExit: true,
    killTimeoutMs: STOP_KILL_TIMEOUT_MS,
  })
  if (result.stopped) return { outcome: 'stopped', pid: result.pid }
  if (result.reason === 'not-running') return { outcome: 'not-running' }
  const detail = result.error instanceof Error ? `: ${result.error.message}` : ''
  return {
    outcome: 'failed',
    message: `Could not stop the daemon (${result.reason ?? 'unknown'})${detail}`,
  }
}

function reportStop(stop: StopOutcome, json: boolean | undefined): void {
  if (stop.outcome === 'failed') {
    fail(stop.message)
    return
  }
  if (json) {
    printJSON(
      stop.outcome === 'stopped' ? { state: 'stopped', pid: stop.pid } : { state: 'not-running' },
    )
    return
  }
  if (stop.outcome === 'stopped') {
    process.stdout.write(`daemon stopped${stop.pid == null ? '' : ` (pid ${stop.pid})`}\n`)
  } else {
    process.stdout.write('daemon not running\n')
  }
}

async function runStatus(options: CommandOptions): Promise<void> {
  const { socketPath } = options
  const identity = await resolveDaemonIdentity(socketPath)
  const result: Record<string, unknown> = { state: identity.state }
  if (identity.pid != null) result.pid = identity.pid
  if (identity.otherSocketPath != null) result.otherSocketPath = identity.otherSocketPath
  if (identity.state === 'running' || identity.state === 'booting') result.socketPath = socketPath
  if (identity.state === 'running') {
    try {
      const connection = await connectFlowControl({ socketPath, autoStart: false })
      try {
        const info = await connection.client.request('info')
        result.uptimeMs = Math.max(0, Date.now() - info.startedTime)
        result.activeContexts = Object.keys(info.activeContexts).length
        result.flowService = info.flowService
      } finally {
        await connection.dispose()
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
  }
  if (options.json) {
    printJSON(result)
    return
  }
  const lines = [`${identity.state}${identity.pid == null ? '' : ` (pid ${identity.pid})`}`]
  if (identity.otherSocketPath != null) {
    lines.push(`another daemon serves ${identity.otherSocketPath}`)
  }
  if (result.uptimeMs != null) lines.push(`uptime: ${Math.round(Number(result.uptimeMs) / 1000)}s`)
  if (result.activeContexts != null) lines.push(`active contexts: ${result.activeContexts}`)
  if (result.flowService != null) {
    lines.push(`flow service: ${(result.flowService as { state: string }).state}`)
  }
  if (result.error != null) lines.push(`could not query the daemon: ${result.error}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

function lastLines(text: string, count: number): string {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.slice(-count).join('\n')
}

async function runLogs(options: { lines: string; follow?: boolean }): Promise<void> {
  const count = Number(options.lines)
  if (!/^\d+$/.test(options.lines) || !Number.isSafeInteger(count)) {
    fail(`Invalid line count "${options.lines}"`)
    return
  }
  const logPath = join(getLogDir(APP), 'daemon.log')
  let content: string
  try {
    content = await readFile(logPath, 'utf8')
  } catch (error) {
    fail(`Cannot read ${logPath}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const tail = count === 0 ? '' : lastLines(content, count)
  if (tail !== '') process.stdout.write(`${tail}\n`)
  if (!options.follow) return
  try {
    await withCommandSignal((signal) => followLog(logPath, Buffer.byteLength(content), signal))
  } catch (error) {
    fail(`Cannot follow ${logPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function followLog(path: string, start: number, signal: AbortSignal): Promise<void> {
  let offset = start
  let reading = Promise.resolve()
  let failure: unknown
  let wake: (() => void) | undefined
  const readMore = async () => {
    const size = (await stat(path)).size
    if (size < offset) offset = 0 // truncated or rotated
    if (size === offset) return
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(size - offset)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      offset += bytesRead
      process.stdout.write(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }
  const stopWith = (error: unknown) => {
    failure ??= error
    wake?.()
  }
  const schedule = () => {
    reading = reading.then(readMore).catch(stopWith)
  }
  let watcher: FSWatcher | undefined
  let timer: NodeJS.Timeout | undefined
  const onAbort = () => wake?.()
  try {
    watcher = watch(path, schedule)
    watcher.on('error', stopWith)
    // Polling covers platforms where fs.watch misses appends.
    timer = setInterval(schedule, 1000)
    await new Promise<void>((resolve) => {
      wake = resolve
      if (signal.aborted || failure != null) return resolve()
      signal.addEventListener('abort', onAbort, { once: true })
    })
  } finally {
    clearInterval(timer)
    signal.removeEventListener('abort', onAbort)
    watcher?.close()
    await reading
  }
  if (failure != null) throw failure
}

export function createDaemonCommand(): Command {
  const daemon = new Command('daemon').description('Manage the mokei host daemon')

  const start = daemon
    .command('start')
    .description('Start the daemon and wait for the flow service')
  addJSONOption(withSocketPath(start)).action(async (options: CommandOptions) => {
    reportStart(await runStart(options.socketPath), options.json)
  })

  const stop = daemon.command('stop').description('Stop the daemon, letting in-flight work drain')
  addJSONOption(withSocketPath(stop)).action(async (options: CommandOptions) => {
    reportStop(await runStop(options.socketPath), options.json)
  })

  const status = daemon.command('status').description('Show whether the daemon is running')
  addJSONOption(withSocketPath(status)).action(async (options: CommandOptions) => {
    await runStatus(options)
  })

  const restart = daemon
    .command('restart')
    .description('Stop then start the daemon, applying flows.json changes')
  addJSONOption(withSocketPath(restart)).action(async (options: CommandOptions) => {
    const stopped = await runStop(options.socketPath)
    // An absent daemon is fine to start; any other non-stopped outcome (socket mismatch, stop
    // failure) must not start anything.
    if (stopped.outcome === 'failed') {
      reportStop(stopped, options.json)
      return
    }
    const started = await runStart(options.socketPath)
    if (!options.json) {
      reportStop(stopped, false)
      reportStart(started, false)
      return
    }
    if (started.value != null) printJSON({ stop: stopped, start: started.value })
    if (!started.ok) fail(started.message)
  })

  daemon
    .command('logs')
    .description('Print the daemon log')
    .option('-n, --lines <count>', 'number of lines to show', String(DEFAULT_LOG_LINES))
    .option('-f, --follow', 'follow the log until interrupted')
    .action(runLogs)

  return daemon
}
