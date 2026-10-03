import {
  type FlowControl,
  hasChanged,
  isActionable,
  isFlowControlError,
  type PendingItem,
  type RunStatus,
  TERMINAL_RUN_STATES,
  waitForRun,
} from '@mokei/flow-client'
import { StatusLine } from '@tejika/ui'
import { type Instance, render } from 'ink'

import { formatRunStatus, printNDJSON } from './output.js'
import { promptApproval, promptForm, UnsupportedSchemaError } from './prompts/index.js'

/** Each wait is bounded; on timeout the loop simply waits again. */
const WAIT_TIMEOUT_MS = 5 * 60_000

export type FollowRunOptions = {
  /** Answer pending inputs and approvals in the terminal. Ignored when `json` is set. */
  interactive: boolean
  /** Print one `RunStatus` per change as NDJSON. */
  json: boolean
  signal: AbortSignal
}

function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATES.includes(status.state)
}

/** `formatRunStatus` followed by the run result, when present. */
export function formatRunDetails(status: RunStatus): string {
  const text = formatRunStatus(status)
  return status.result === undefined ? text : `${text}\n  result: ${JSON.stringify(status.result)}`
}

function printStatus(status: RunStatus, json: boolean): void {
  if (json) {
    printNDJSON(status)
  } else {
    process.stdout.write(`${formatRunDetails(status)}\n`)
  }
}

function printError(message: string): void {
  process.stderr.write(`✘ ${message}\n`)
}

type LiveStatus = { update(status: RunStatus): void; clear(): void }

/** A single live `StatusLine` showing the run state; cleared before prompts and at the end. */
function createLiveStatus(): LiveStatus {
  let instance: Instance | undefined
  return {
    update(status) {
      const label = `${status.runID}  ${status.state}`
      const element = <StatusLine busy label={label} />
      if (instance == null) {
        instance = render(element)
      } else {
        instance.rerender(element)
      }
    },
    clear() {
      instance?.clear()
      instance?.unmount()
      instance = undefined
    },
  }
}

async function answerInput(control: FlowControl, id: string, signal: AbortSignal): Promise<void> {
  const item = await control.inbox.get(id)
  if (item.kind === 'approval') {
    const approved = await promptApproval(item)
    signal.throwIfAborted()
    if (approved) {
      await control.inbox.answer(item.id)
    } else {
      await control.inbox.decline(item.id)
    }
    return
  }
  for (;;) {
    const values = await promptForm(item)
    signal.throwIfAborted()
    if (values === undefined) {
      process.stderr.write(
        `Left ${item.id} pending; answer it later with: mokei inbox answer ${item.id}\n`,
      )
      return
    }
    try {
      await control.inbox.answer(item.id, values)
      return
    } catch (error) {
      if (!isFlowControlError(error, 'INBOX_ANSWER_INVALID')) throw error
      const issues = error.data?.issues
      const lines =
        Array.isArray(issues) && issues.length > 0 ? issues.map(String) : [error.message]
      for (const line of lines) printError(line)
    }
  }
}

/** Answers one pending item. Errors that leave the run watchable are reported, not thrown. */
async function answerItem(
  control: FlowControl,
  item: PendingItem,
  signal: AbortSignal,
): Promise<void> {
  try {
    await answerInput(control, item.id, signal)
  } catch (error) {
    // Settled elsewhere (another client, or the run moved on): nothing left to answer.
    if (isFlowControlError(error, 'INBOX_ITEM_NOT_FOUND')) return
    if (error instanceof UnsupportedSchemaError) {
      printError(`${item.id}: ${error.message} (mokei inbox answer ${item.id} --value <json>)`)
      return
    }
    throw error
  }
}

async function followInteractive(
  control: FlowControl,
  runID: string,
  signal: AbortSignal,
): Promise<RunStatus> {
  // Items answered or skipped (Esc, unsupported schema) are not prompted again.
  const handled = new Set<string>()
  const hasUnhandled = (status: RunStatus) => status.pending.some((item) => !handled.has(item.id))
  const live = process.stdout.isTTY === true ? createLiveStatus() : undefined
  let last: RunStatus | undefined
  try {
    for (;;) {
      const previous = last
      const { status, timedOut } = await waitForRun(control, runID, {
        until: (next) =>
          (isActionable(next) && (isTerminal(next) || hasUnhandled(next))) ||
          previous == null ||
          hasChanged(previous)(next),
        timeoutMs: WAIT_TIMEOUT_MS,
        signal,
      })
      last = status
      if (isTerminal(status)) {
        live?.clear()
        printStatus(status, false)
        return status
      }
      live?.update(status)
      if (timedOut) continue
      for (const item of status.pending) {
        if (handled.has(item.id)) continue
        handled.add(item.id)
        signal.throwIfAborted()
        live?.clear()
        await answerItem(control, item, signal)
      }
    }
  } finally {
    live?.clear()
  }
}

async function followChanges(
  control: FlowControl,
  runID: string,
  json: boolean,
  signal: AbortSignal,
): Promise<RunStatus> {
  let last: RunStatus | undefined
  for (;;) {
    const { status, timedOut } = await waitForRun(control, runID, {
      until: last == null ? () => true : hasChanged(last),
      timeoutMs: WAIT_TIMEOUT_MS,
      signal,
    })
    if (!timedOut) {
      printStatus(status, json)
      last = status
    }
    if (isTerminal(status)) return status
  }
}

/**
 * Watches a run until it is terminal and resolves its final status. Interactive mode (never with
 * `json`) shows a live status line and answers each pending item in the terminal; Esc leaves an
 * item pending and keeps watching. Otherwise it prints each changed status once, as NDJSON when
 * `json` is set. Rejects with the signal's reason when aborted.
 */
export async function followRun(
  control: FlowControl,
  runID: string,
  options: FollowRunOptions,
): Promise<RunStatus> {
  return options.interactive && !options.json
    ? await followInteractive(control, runID, options.signal)
    : await followChanges(control, runID, options.json, options.signal)
}
