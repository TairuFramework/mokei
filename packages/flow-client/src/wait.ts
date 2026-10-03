import { raceAbort } from './abort.js'
import { FlowControlError, isFlowControlError } from './errors.js'
import {
  type FlowControl,
  type FlowEvent,
  type FlowRunSnapshot,
  type InboxItem,
  type PendingItem,
  type RunStatus,
  TERMINAL_RUN_STATES,
} from './types.js'

/** Maximum number of inbox reads `runStatus` performs while the run state keeps changing. */
const MAX_STATUS_READS = 3
const INITIAL_BACKOFF_MS = 250
const MAX_BACKOFF_MS = 2_000

function isTerminal(snapshot: { state: FlowRunSnapshot['state'] }): boolean {
  return TERMINAL_RUN_STATES.includes(snapshot.state)
}

function toPendingItem(item: InboxItem, canPrompt: boolean): PendingItem {
  if (item.kind === 'approval') {
    return { id: item.id, kind: 'approval', plan: { tools: [...item.plan.tools] }, canPrompt }
  }
  return {
    id: item.id,
    kind: 'input',
    message: item.message,
    requestedSchema: item.requestedSchema,
    canPrompt,
  }
}

function toRunStatus(snapshot: FlowRunSnapshot, pending: Array<PendingItem>): RunStatus {
  const status: RunStatus = { runID: snapshot.runID, state: snapshot.state, pending }
  if (snapshot.result !== undefined) status.result = snapshot.result
  if (snapshot.error !== undefined) status.error = snapshot.error
  return status
}

/**
 * Reads the run snapshot and its pending inbox items. If the run state changes between the
 * snapshot read and the read that follows the inbox query, it reads again, at most three times.
 * `pending` is empty for terminal runs.
 */
export async function runStatus(control: FlowControl, runID: string): Promise<RunStatus> {
  const canPrompt = typeof control.inbox.prompt === 'function'
  let snapshot = await control.runs.get(runID)
  for (let reads = 1; ; reads++) {
    if (isTerminal(snapshot)) return toRunStatus(snapshot, [])
    const items = await control.inbox.list({ runID })
    const latest = await control.runs.get(runID)
    if (latest.state === snapshot.state || reads >= MAX_STATUS_READS) {
      const pending = isTerminal(latest)
        ? []
        : items.filter((item) => item.runID === runID).map((item) => toPendingItem(item, canPrompt))
      return toRunStatus(latest, pending)
    }
    snapshot = latest
  }
}

/**
 * True when the run is terminal or has at least one pending item. A run waiting for input or
 * approval with no pending item (an answer settled, the state has not advanced yet) is not.
 */
export function isActionable(status: RunStatus): boolean {
  return TERMINAL_RUN_STATES.includes(status.state) || status.pending.length > 0
}

function pendingKey(status: RunStatus): string {
  return status.pending
    .map((item) => item.id)
    .sort()
    .join('\n')
}

/**
 * Returns a predicate true when a status differs from `previous` in state, pending item ids,
 * result or error.
 */
export function hasChanged(previous: RunStatus): (status: RunStatus) => boolean {
  const previousPending = pendingKey(previous)
  const previousResult = JSON.stringify(previous.result)
  const previousError = JSON.stringify(previous.error)
  return (status) =>
    status.state !== previous.state ||
    pendingKey(status) !== previousPending ||
    JSON.stringify(status.result) !== previousResult ||
    JSON.stringify(status.error) !== previousError
}

export type WaitForRunOptions = {
  until: (status: RunStatus) => boolean
  timeoutMs: number
  signal?: AbortSignal
}

export type WaitForRunResult = { status: RunStatus; timedOut: boolean }

function concernsRun(event: FlowEvent, runID: string): boolean {
  switch (event.type) {
    case 'run:state':
      return event.data.runID === runID
    case 'inbox:added':
      return event.data.runID === runID
    case 'inbox:settled':
      return event.data.item.runID === runID
    default:
      return false
  }
}

/** A lost connection, or a flow service still recovering after a daemon restart. */
function isRetryable(error: unknown): boolean {
  if (isFlowControlError(error, 'DISCONNECTED')) return true
  if (isFlowControlError(error, 'FLOW_UNAVAILABLE')) {
    const status = error.data?.status as { state?: unknown } | undefined
    return status?.state === 'starting'
  }
  return false
}

/** Resolves after `ms`, or as soon as the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Waits until `until` matches the run status. Subscribes first (awaiting readiness), then reads
 * the status, and rereads it on every event for the run. A lost connection, or a flow service
 * still starting, is retried with backoff (250 ms doubling to 2 s) within the timeout. On timeout
 * it returns the latest status with `timedOut: true`; on abort it rejects with the signal's reason.
 * If the timeout passes before any status read succeeded, there is no status to return: it rejects
 * with the last retryable error (`DISCONNECTED`, or `FLOW_UNAVAILABLE` while starting).
 */
export async function waitForRun(
  control: FlowControl,
  runID: string,
  options: WaitForRunOptions,
): Promise<WaitForRunResult> {
  const { until, timeoutMs, signal } = options
  signal?.throwIfAborted()

  const stop = new AbortController()
  const onAbort = () => stop.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => stop.abort(), timeoutMs)

  let latest: RunStatus | undefined
  let lastError: unknown
  let backoff = INITIAL_BACKOFF_MS

  const read = async (): Promise<RunStatus> => {
    const status = await raceAbort(runStatus(control, runID), stop.signal)
    latest = status
    return status
  }

  try {
    while (!stop.signal.aborted) {
      try {
        const subscription = await raceAbort(control.subscribe(stop.signal), stop.signal)
        try {
          const status = await read()
          if (until(status)) return { status, timedOut: false }
          backoff = INITIAL_BACKOFF_MS
          for await (const event of subscription) {
            if (!concernsRun(event, runID)) continue
            const next = await read()
            if (until(next)) return { status: next, timedOut: false }
          }
        } finally {
          subscription.close()
        }
        if (stop.signal.aborted) break
        // The subscription ended without an error or a stop: treat it as a lost connection.
      } catch (error) {
        if (stop.signal.aborted) break
        if (!isRetryable(error)) throw error
        lastError = error
      }
      await sleep(backoff, stop.signal)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    }

    if (signal?.aborted) throw signal.reason
    if (latest == null) {
      // Timed out before any read succeeded: there is no status to return.
      throw (
        lastError ??
        new FlowControlError({
          code: 'DISCONNECTED',
          message: `Could not reach the flow daemon before the wait for run ${runID} timed out`,
        })
      )
    }
    return { status: latest, timedOut: true }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (!stop.signal.aborted) stop.abort()
  }
}
