import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { raceAttempt, TimeoutInterruption } from '@sozai/async'
import type { DaemonCommandContext } from '@tejika/cli'
import { createDaemonCommand as createTejikaDaemonCommand } from '@tejika/cli'
import { createDeadline, isSocketLive, waitForSocket } from '@tejika/process'
import type { Command } from 'commander'

import { connectFlowControl } from '../flow-control.js'

const APP = 'mokei'
const STOP_KILL_TIMEOUT_MS = 75_000
const START_TIMEOUT_MS = 30_000
const START_POLL_MS = 100
const DAEMON_ENTRY = fileURLToPath(new URL('../daemon-entry.js', import.meta.url))

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

async function waitReady({ socketPath, signal }: DaemonCommandContext) {
  const deadline = Date.now() + START_TIMEOUT_MS
  if (!(await isSocketLive(socketPath))) {
    await waitForSocket(socketPath, {
      deadline: createDeadline(Math.max(0, deadline - Date.now()), signal),
    })
  }
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
    if (info.flowService.state === 'failed') {
      const { message, issues = [] } = info.flowService.error
      throw new Error(
        [`Flow service failed: ${message}`, ...issues.map((issue) => `  ${issue}`)].join('\n'),
      )
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

  start.description('Start the daemon and wait for the flow service')
  restart.description('Stop then start the daemon, applying flows.json changes')

  return daemon
}
