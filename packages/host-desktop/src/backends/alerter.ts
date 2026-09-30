import type { Runner, RunResult } from '../runner.js'
import {
  type AskRequest,
  type AskResult,
  type DesktopBackend,
  getNativeTimeoutSeconds,
  requireChoices,
  unexpectedExit,
} from './types.js'

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
  }
}
