import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { FlowServiceStatus } from '@mokei/host-protocol'
import { raceAttempt, TimeoutInterruption } from '@sozai/async'
import type { DaemonCommandContext, DaemonIdentity } from '@tejika/cli'
import {
  createDaemonCommand as createTejikaDaemonCommand,
  resolveDaemonIdentity as resolveTejikaDaemonIdentity,
  withCommandSignal,
} from '@tejika/cli'
import { getPIDPath } from '@tejika/env'
import { createDeadline, spawnDaemon, stopDaemon, waitForSocket } from '@tejika/process'
import type { Command } from 'commander'

import { connectFlowControl } from '../flow-control.js'
import { fail, printJSON } from '../output.js'

const APP = 'mokei'
const STOP_KILL_TIMEOUT_MS = 75_000
const START_TIMEOUT_MS = 30_000
const START_POLL_MS = 100
const DAEMON_ENTRY = fileURLToPath(new URL('../daemon-entry.js', import.meta.url))

export async function resolveDaemonIdentity(
  socketPath: string,
  pidPath = getPIDPath(APP),
): Promise<DaemonIdentity> {
  return await resolveTejikaDaemonIdentity(APP, socketPath, pidPath)
}

function mismatchMessage(socketPath: string, other: string): string {
  return `The daemon serves ${other}, not the selected socket ${socketPath}`
}

type CommandOptions = { socketPath: string; pidPath: string; json?: boolean }

type StartResult = { pid?: number; socketPath: string; flowService: FlowServiceStatus }
type Outcome<T> = { ok: true; value: T } | { ok: false; message: string; value?: T }

/** Rejects when the signal aborts or the deadline passes, even if `work` never settles. */
function bounded<T>(work: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
  // raceAttempt never calls `fn` once aborted or past the deadline, so `work` needs its own handler.
  work.catch(() => {})
  return raceAttempt({ fn: () => work, signal, deadline }).catch((error: unknown) => {
    if (signal.aborted && error === signal.reason) {
      throw new Error('Interrupted while waiting for the flow service', { cause: error })
    }
    if (error instanceof TimeoutInterruption) {
      throw new Error(`The flow service is still starting after ${START_TIMEOUT_MS / 1000}s`, {
        cause: error,
      })
    }
    throw error
  })
}

async function waitReady(
  { socketPath, signal }: DaemonCommandContext,
  deadline = Date.now() + START_TIMEOUT_MS,
) {
  const connection = await connectFlowControl({ socketPath, autoStart: false })
  try {
    let info = await bounded(connection.client.request('info'), signal, deadline)
    while (info.flowService.state === 'starting') {
      // `bounded` reports the abort; the delay's own AbortError is not needed.
      await bounded(
        delay(START_POLL_MS, undefined, { signal }).catch(() => {}),
        signal,
        deadline,
      )
      info = await bounded(connection.client.request('info'), signal, deadline)
    }
    return { flowService: info.flowService }
  } finally {
    await connection.dispose()
  }
}

async function describeStatus({ socketPath, signal }: DaemonCommandContext) {
  const connection = await connectFlowControl({ socketPath, autoStart: false })
  try {
    const info = await raceAttempt({ fn: () => connection.client.request('info'), signal })
    return {
      uptimeMs: Math.max(0, Date.now() - info.startedTime),
      activeContexts: Object.keys(info.activeContexts).length,
      flowService: info.flowService,
    }
  } finally {
    await connection.dispose()
  }
}

// The factory cannot include failed readiness fields or mokei's start summary in its output.
async function runStart(socketPath: string, pidPath: string): Promise<Outcome<StartResult>> {
  return await withCommandSignal(async (signal) => {
    const deadline = Date.now() + START_TIMEOUT_MS
    try {
      const identity = await resolveDaemonIdentity(socketPath, pidPath)
      if (identity.otherSocketPath != null) {
        return { ok: false, message: mismatchMessage(socketPath, identity.otherSocketPath) }
      }
      if (identity.state !== 'running' && identity.state !== 'booting') {
        await spawnDaemon({
          app: APP,
          entry: DAEMON_ENTRY,
          socketPath,
          pidPath,
          timeoutMs: START_TIMEOUT_MS,
          signal,
        })
      } else if (identity.state === 'booting') {
        await waitForSocket(socketPath, { deadline: createDeadline(START_TIMEOUT_MS, signal) })
      }
      const { flowService } = await waitReady({ socketPath, pidPath, signal }, deadline)
      const current = await resolveDaemonIdentity(socketPath, pidPath)
      const value = { pid: current.pid, socketPath, flowService }
      if (flowService.state === 'failed') {
        const { message, issues = [] } = flowService.error
        const lines = [`Flow service failed: ${message}`, ...issues.map((issue) => `  ${issue}`)]
        return { ok: false, message: lines.join('\n'), value }
      }
      return { ok: true, value }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
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
  | { state: 'stopped'; pid?: number; forced: boolean }
  | { state: 'not-running' }
  | { state: 'failed'; message: string }

/** The JSON shape of a stop, shared by `daemon stop --json` and the `stop` field of `restart`. */
type StopJSON = { state: 'stopped'; pid?: number; forced: boolean } | { state: 'not-running' }

function stopJSON(stop: StopOutcome & { state: 'stopped' | 'not-running' }): StopJSON {
  if (stop.state === 'not-running') return { state: 'not-running' }
  const json: StopJSON = { state: 'stopped', forced: stop.forced }
  if (stop.pid != null) json.pid = stop.pid
  return json
}

async function runStop(
  socketPath: string,
  pidPath: string,
  signal: AbortSignal,
): Promise<StopOutcome> {
  const identity = await resolveDaemonIdentity(socketPath, pidPath)
  if (identity.otherSocketPath != null) {
    return { state: 'failed', message: mismatchMessage(socketPath, identity.otherSocketPath) }
  }
  const result = await stopDaemon({
    app: APP,
    pidPath,
    waitForExit: true,
    killTimeoutMs: STOP_KILL_TIMEOUT_MS,
    // Checked under the boot mutex: a daemon replaced since the identity read is not signalled.
    expectedSocketPath: socketPath,
    signal,
  })
  if (result.stopped) return { state: 'stopped', pid: result.pid, forced: result.forced === true }
  if (result.reason === 'not-running') return { state: 'not-running' }
  if (result.reason === 'socket-mismatch') {
    const current = await resolveDaemonIdentity(socketPath, pidPath)
    const other = current.otherSocketPath ?? 'another socket'
    return { state: 'failed', message: mismatchMessage(socketPath, other) }
  }
  const detail = result.error instanceof Error ? `: ${result.error.message}` : ''
  return {
    state: 'failed',
    message: `Could not stop the daemon (${result.reason ?? 'unknown'})${detail}`,
  }
}

function reportStop(stop: StopOutcome, json: boolean | undefined): void {
  if (stop.state === 'failed') {
    fail(stop.message)
    return
  }
  if (json) {
    printJSON(stopJSON(stop))
    return
  }
  if (stop.state === 'not-running') {
    process.stdout.write('daemon not running\n')
  } else if (stop.forced) {
    process.stdout.write(
      `daemon did not exit in time; force-killed${stop.pid == null ? '' : ` (pid ${stop.pid})`}\n`,
    )
  } else {
    process.stdout.write(`daemon stopped${stop.pid == null ? '' : ` (pid ${stop.pid})`}\n`)
  }
}

export function createDaemonCommand(): Command {
  const daemon = createTejikaDaemonCommand({
    app: APP,
    entry: DAEMON_ENTRY,
    description: 'Manage the mokei host daemon',
    startTimeoutMs: START_TIMEOUT_MS,
    stopKillTimeoutMs: STOP_KILL_TIMEOUT_MS,
    waitReady,
    describeStatus,
  })
  const start = daemon.commands.find((command) => command.name() === 'start')
  const restart = daemon.commands.find((command) => command.name() === 'restart')
  if (start == null || restart == null) throw new Error('Daemon lifecycle commands are missing')

  start
    .description('Start the daemon and wait for the flow service')
    .action(async (options: CommandOptions) => {
      reportStart(await runStart(options.socketPath, options.pidPath), options.json)
    })

  restart
    .description('Stop then start the daemon, applying flows.json changes')
    .action(async (options: CommandOptions) => {
      const stopped = await withCommandSignal((signal) => {
        return runStop(options.socketPath, options.pidPath, signal)
      })
      if (stopped.state === 'failed') {
        reportStop(stopped, options.json)
        return
      }
      const started = await runStart(options.socketPath, options.pidPath)
      if (!options.json) {
        reportStop(stopped, false)
        reportStart(started, false)
        return
      }
      if (started.value != null) printJSON({ stop: stopJSON(stopped), start: started.value })
      if (!started.ok) fail(started.message)
    })

  return daemon
}
