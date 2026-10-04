import { sleep } from '@sozai/async'

import type { Runner, RunResult } from '../runner.js'
import {
  type AskRequest,
  type AskResult,
  type DesktopBackend,
  getNativeTimeoutSeconds,
  type NotifyCallOptions,
  type NotifyDelivery,
  type NotifyRequest,
  requireChoices,
  unexpectedExit,
} from './types.js'

/**
 * How long a notification stays clickable. alerter keeps running until the user interacts, and
 * removes the notification when it exits, so this bounds both: long enough to come back from a
 * short break and click it in Notification Center, short enough that idle notifications do not
 * pile up live processes.
 */
export const ALERTER_NOTIFY_TIMEOUT_SECONDS = 600
/** alerter prints nothing until interaction: still running after this long counts as delivered. */
export const ALERTER_DELIVERY_MS = 1000
/** Runner timeout margin over the native timeout, so the native timeout reports first. */
const ALERTER_EXIT_GRACE_MS = 10_000

const ALERTER_COMMA_REASON = 'alerter cannot show a choice label containing a comma'
const ALERTER_DASH_REASON =
  'alerter cannot show a value starting with "-", which it could read as an option'

/**
 * Whether alerter can show the request.
 *
 * - alerter takes `--actions` as a comma-separated list, so a label containing `,` cannot be shown.
 * - alerter has no `--` terminator, so an option value starting with `-` (title, text, reply
 *   default or the actions list) could be parsed as an option.
 */
export function alerterCanShow(request: AskRequest): { ok: true } | { ok: false; reason: string } {
  const labels = (request.choices ?? []).map((choice) => choice.label)
  if (labels.some((label) => label.includes(','))) {
    return { ok: false, reason: ALERTER_COMMA_REASON }
  }
  const values = [request.title, request.text]
  if (request.kind === 'text') {
    values.push(request.default ?? '')
  } else if (request.kind === 'choice') {
    values.push(labels.join(','))
  }
  if (values.some((value) => value.startsWith('-'))) {
    return { ok: false, reason: ALERTER_DASH_REASON }
  }
  return { ok: true }
}

/** Whether alerter can show the notification without reading a value as an option. */
export function alerterCanNotify(
  request: NotifyRequest,
  group?: string,
): { ok: true } | { ok: false; reason: string } {
  const values = [request.title, request.message, request.subtitle ?? '', group ?? '']
  if (values.some((value) => value.startsWith('-'))) {
    return { ok: false, reason: ALERTER_DASH_REASON }
  }
  return { ok: true }
}

export function buildAlerterNotifyArgs(
  request: NotifyRequest,
  nativeTimeoutSeconds: number,
  group?: string,
): Array<string> {
  const args = [
    '--json',
    '--timeout',
    String(nativeTimeoutSeconds),
    '--title',
    request.title,
    '--message',
    request.message,
  ]
  if (request.subtitle != null && request.subtitle !== '') args.push('--subtitle', request.subtitle)
  if (request.sound === true) args.push('--sound', 'default')
  if (group != null && group !== '') args.push('--group', group)
  return args
}

/** Whether the user clicked the notification body or its action button. */
export function parseAlerterNotifyResult(result: RunResult): boolean {
  if (result.timedOut) {
    return false
  }
  if (result.code !== 0) {
    throw unexpectedExit('alerter', result)
  }
  let output: AlerterOutput
  try {
    output = JSON.parse(result.stdout) as AlerterOutput
  } catch (cause) {
    throw new Error('alerter printed output that is not valid JSON', { cause })
  }
  // `closed`, `timeout` and a replaced notification (reported as `closed`) are not clicks
  return output.activationType === 'contentsClicked' || output.activationType === 'actionClicked'
}

async function notifyWithAlerter(
  runner: Runner,
  request: NotifyRequest,
  { timeoutMs, signal, group, lifetime, onClick }: NotifyCallOptions,
): Promise<NotifyDelivery> {
  signal.throwIfAborted()
  const kill = new AbortController()
  const processSignal = lifetime == null ? kill.signal : AbortSignal.any([kill.signal, lifetime])
  const exit = runner.run(
    'alerter',
    buildAlerterNotifyArgs(request, ALERTER_NOTIFY_TIMEOUT_SECONDS, group),
    {
      timeoutMs: ALERTER_NOTIFY_TIMEOUT_SECONDS * 1000 + ALERTER_EXIT_GRACE_MS,
      signal: processSignal,
    },
  )
  const clicked = exit.then(parseAlerterNotifyResult)
  // After delivery, a failure or kill only means the notification is gone
  void clicked
    .then((wasClicked) => {
      if (wasClicked) onClick?.()
    })
    .catch(() => {})
  try {
    // An option error exits at once; a shown notification keeps alerter running
    await Promise.race([
      clicked.then(() => undefined),
      sleep(Math.min(ALERTER_DELIVERY_MS, timeoutMs), signal),
    ])
  } catch (error) {
    kill.abort(error)
    throw error
  }
  return { closed: exit.then(noop, noop) }
}

function noop(): void {}

export function buildAlerterArgs(request: AskRequest, nativeTimeoutSeconds: number): Array<string> {
  const args = [
    '--json',
    '--timeout',
    String(nativeTimeoutSeconds),
    '--title',
    request.title,
    '--message',
    request.text,
  ]
  switch (request.kind) {
    case 'text':
      args.push('--reply', request.default ?? '')
      break
    case 'confirm':
      args.push('--actions', 'Yes,No')
      break
    case 'choice':
      args.push(
        '--actions',
        requireChoices(request)
          .map((choice) => choice.label)
          .join(','),
      )
      break
  }
  return args
}

type AlerterOutput = { activationType?: unknown; activationValue?: unknown }

export function parseAlerterResult(request: AskRequest, result: RunResult): AskResult {
  if (result.timedOut) {
    return { status: 'timeout' }
  }
  if (result.code !== 0) {
    throw unexpectedExit('alerter', result)
  }
  let output: AlerterOutput
  try {
    output = JSON.parse(result.stdout) as AlerterOutput
  } catch (cause) {
    throw new Error('alerter printed output that is not valid JSON', { cause })
  }
  const value = typeof output.activationValue === 'string' ? output.activationValue : ''
  switch (output.activationType) {
    case 'timeout':
      return { status: 'timeout' }
    case 'closed':
    case 'contentsClicked':
      return { status: 'dismissed' }
    case 'replied':
      return { status: 'answered', value }
    case 'actionClicked': {
      if (request.kind === 'confirm') {
        if (value === 'Yes' || value === 'No') {
          return { status: 'answered', value: value === 'Yes' }
        }
      } else if (request.kind === 'choice') {
        const choice = requireChoices(request).find((c) => c.label === value)
        if (choice != null) {
          return { status: 'answered', value: choice.value }
        }
      }
      throw new Error(`alerter reported an unexpected action: ${value}`)
    }
    default:
      throw new Error(
        `alerter reported an unknown activationType: ${String(output.activationType)}`,
      )
  }
}

export function createAlerterBackend(runner: Runner): DesktopBackend {
  return {
    name: 'alerter',
    async ask(request, { timeoutMs, signal }) {
      const args = buildAlerterArgs(request, getNativeTimeoutSeconds(timeoutMs))
      const result = await runner.run('alerter', args, { timeoutMs, signal })
      return parseAlerterResult(request, result)
    },
    notify(request, options) {
      return notifyWithAlerter(runner, request, options)
    },
  }
}
