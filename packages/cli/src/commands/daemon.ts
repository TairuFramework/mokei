import { type FSWatcher, watch } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getLogDir, getPIDPath } from '@tejika/env'
import { getDaemonStatus, stopDaemon } from '@tejika/process'
import { Command } from 'commander'

import { connectFlowControl, withCommandSignal } from '../flow-control.js'
import { withSocketPath } from '../options.js'
import { addJSONOption, printJSON } from '../output.js'

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

function fail(message: string): void {
  process.stderr.write(`✘ ${message}\n`)
  process.exitCode = 1
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

async function runStart(options: CommandOptions): Promise<boolean> {
  const { socketPath } = options
  return await withCommandSignal(async (signal) => {
    const connection = await connectFlowControl({ socketPath, autoStart: true })
    try {
      const deadline = Date.now() + START_TIMEOUT_MS
      let info = await connection.client.request('info')
      while (info.flowService.state === 'starting') {
        if (signal.aborted) {
          fail('Interrupted while waiting for the flow service')
          return false
        }
        if (Date.now() >= deadline) {
          fail(`The flow service is still starting after ${START_TIMEOUT_MS / 1000}s`)
          return false
        }
        await sleep(START_POLL_MS, signal)
        info = await connection.client.request('info')
      }
      const identity = await resolveDaemonIdentity(socketPath)
      const flowService = info.flowService
      if (flowService.state === 'failed') {
        const { message, issues = [] } = flowService.error
        const lines = [`Flow service failed: ${message}`, ...issues.map((issue) => `  ${issue}`)]
        if (options.json) {
          printJSON({ pid: identity.pid, socketPath, flowService })
        }
        fail(lines.join('\n'))
        return false
      }
      if (options.json) {
        printJSON({ pid: identity.pid, socketPath, flowService })
      } else {
        process.stdout.write(
          `daemon running (pid ${identity.pid ?? 'unknown'})\nsocket: ${socketPath}\nflow service: ${flowService.state}\n`,
        )
      }
      return true
    } finally {
      await connection.dispose()
    }
  })
}

async function runStop(options: CommandOptions): Promise<boolean> {
  const { socketPath } = options
  const identity = await resolveDaemonIdentity(socketPath)
  if (identity.otherSocketPath != null) {
    fail(mismatchMessage(socketPath, identity.otherSocketPath))
    return false
  }
  const result = await stopDaemon({
    app: APP,
    pidPath: getPIDPath(APP),
    waitForExit: true,
    killTimeoutMs: STOP_KILL_TIMEOUT_MS,
  })
  if (result.stopped) {
    if (options.json) printJSON({ state: 'stopped', pid: result.pid })
    else process.stdout.write(`daemon stopped${result.pid == null ? '' : ` (pid ${result.pid})`}\n`)
    return true
  }
  if (result.reason === 'not-running') {
    if (options.json) printJSON({ state: 'not-running' })
    else process.stdout.write('daemon not running\n')
    return true
  }
  const detail = result.error instanceof Error ? `: ${result.error.message}` : ''
  fail(`Could not stop the daemon (${result.reason ?? 'unknown'})${detail}`)
  return false
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
  const count = Number.parseInt(options.lines, 10)
  if (!Number.isInteger(count) || count < 0) {
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
  await withCommandSignal((signal) => followLog(logPath, Buffer.byteLength(content), signal))
}

async function followLog(path: string, start: number, signal: AbortSignal): Promise<void> {
  let offset = start
  let reading = Promise.resolve()
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
  const schedule = () => {
    reading = reading.then(readMore).catch(() => {})
  }
  let watcher: FSWatcher | undefined
  await new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    watcher = watch(path, schedule)
    // Polling covers platforms where fs.watch misses appends.
    const timer = setInterval(schedule, 1000)
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer)
        resolve()
      },
      { once: true },
    )
  })
  watcher?.close()
  await reading
}

export function createDaemonCommand(): Command {
  const daemon = new Command('daemon').description('Manage the mokei host daemon')

  const start = daemon
    .command('start')
    .description('Start the daemon and wait for the flow service')
  addJSONOption(withSocketPath(start)).action(async (options: CommandOptions) => {
    if (!(await runStart(options))) process.exitCode = 1
  })

  const stop = daemon.command('stop').description('Stop the daemon, letting in-flight work drain')
  addJSONOption(withSocketPath(stop)).action(async (options: CommandOptions) => {
    await runStop(options)
  })

  const status = daemon.command('status').description('Show whether the daemon is running')
  addJSONOption(withSocketPath(status)).action(async (options: CommandOptions) => {
    await runStatus(options)
  })

  const restart = daemon
    .command('restart')
    .description('Stop then start the daemon, applying flows.json changes')
  addJSONOption(withSocketPath(restart)).action(async (options: CommandOptions) => {
    if (await runStop(options)) await runStart(options)
  })

  daemon
    .command('logs')
    .description('Print the daemon log')
    .option('-n, --lines <count>', 'number of lines to show', String(DEFAULT_LOG_LINES))
    .option('-f, --follow', 'follow the log until interrupted')
    .action(runLogs)

  return daemon
}
