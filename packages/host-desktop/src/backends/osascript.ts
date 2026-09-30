import type { Runner, RunResult } from '../runner.js'
import {
  type AskKind,
  type AskRequest,
  type AskResult,
  assertNotified,
  type DesktopBackend,
  getDefaultChoiceLabel,
  getNativeTimeoutSeconds,
  type NotifyRequest,
  requireChoices,
  stripTrailingNewline,
  unexpectedExit,
} from './types.js'

// Fixed AppleScript per kind. Every user string arrives through `argv`, never in the source.
// argv for text/confirm: title, text, default, native timeout seconds.
// argv for choice: title, text, default label, then one item per choice label.
// Output: `gave up:<bool>` then the answer on following lines, or `false` for a dismissed list.
export const OSASCRIPT_ASK_SCRIPTS: Record<AskKind, string> = {
  text: [
    'on run argv',
    'set r to display dialog (item 2 of argv) with title (item 1 of argv) default answer (item 3 of argv) buttons {"Cancel", "OK"} default button "OK" giving up after ((item 4 of argv) as integer)',
    'if gave up of r then return "gave up:true"',
    'return "gave up:false" & linefeed & (text returned of r)',
    'end run',
  ].join('\n'),
  confirm: [
    'on run argv',
    'set r to display dialog (item 2 of argv) with title (item 1 of argv) buttons {"No", "Yes"} default button (item 3 of argv) giving up after ((item 4 of argv) as integer)',
    'if gave up of r then return "gave up:true"',
    'return "gave up:false" & linefeed & (button returned of r)',
    'end run',
  ].join('\n'),
  choice: [
    'on run argv',
    'set r to choose from list (items 4 thru -1 of argv) with title (item 1 of argv) with prompt (item 2 of argv) default items {item 3 of argv}',
    'if r is false then return "false"',
    'return "gave up:false" & linefeed & (item 1 of r)',
    'end run',
  ].join('\n'),
}

// argv: title, message, subtitle, "1" when a sound is wanted.
export const OSASCRIPT_NOTIFY_SCRIPT: string = [
  'on run argv',
  'if (item 4 of argv) is "1" then',
  'display notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv) sound name "default"',
  'else',
  'display notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv)',
  'end if',
  'end run',
].join('\n')

function toArgs(script: string, argv: Array<string>): Array<string> {
  return [...script.split('\n').flatMap((line) => ['-e', line]), '--', ...argv]
}

export function buildOsascriptAskArgs(
  request: AskRequest,
  nativeTimeoutSeconds: number,
): Array<string> {
  const script = OSASCRIPT_ASK_SCRIPTS[request.kind]
  switch (request.kind) {
    case 'text':
      return toArgs(script, [
        request.title,
        request.text,
        request.default ?? '',
        String(nativeTimeoutSeconds),
      ])
    case 'confirm':
      return toArgs(script, [
        request.title,
        request.text,
        request.default === 'no' ? 'No' : 'Yes',
        String(nativeTimeoutSeconds),
      ])
    case 'choice': {
      const choices = requireChoices(request)
      const labels = choices.map((choice) => choice.label)
      const defaultLabel = getDefaultChoiceLabel(choices, request.default)
      return toArgs(script, [request.title, request.text, defaultLabel, ...labels])
    }
  }
}

export function parseOsascriptAskResult(request: AskRequest, result: RunResult): AskResult {
  if (result.timedOut) {
    return { status: 'timeout' }
  }
  if (result.code === 1 && result.stderr.includes('-128')) {
    return { status: 'dismissed' }
  }
  if (result.code !== 0) {
    throw unexpectedExit('osascript', result)
  }
  const output = stripTrailingNewline(result.stdout)
  if (output === 'false') {
    return { status: 'dismissed' }
  }
  const newline = output.indexOf('\n')
  const head = newline === -1 ? output : output.slice(0, newline)
  const answer = newline === -1 ? '' : output.slice(newline + 1)
  if (head === 'gave up:true') {
    return { status: 'timeout' }
  }
  if (head !== 'gave up:false') {
    throw new Error('osascript printed unexpected output')
  }
  switch (request.kind) {
    case 'text':
      return { status: 'answered', value: answer }
    case 'confirm':
      return { status: 'answered', value: answer === 'Yes' }
    case 'choice': {
      const choice = requireChoices(request).find((c) => c.label === answer)
      if (choice == null) {
        throw new Error(`osascript returned an unknown choice: ${answer}`)
      }
      return { status: 'answered', value: choice.value }
    }
  }
}

export function buildOsascriptNotifyArgs(request: NotifyRequest): Array<string> {
  return toArgs(OSASCRIPT_NOTIFY_SCRIPT, [
    request.title,
    request.message,
    request.subtitle ?? '',
    request.sound === true ? '1' : '0',
  ])
}

export function createOsascriptBackend(runner: Runner): DesktopBackend {
  return {
    name: 'osascript',
    async ask(request, { timeoutMs, signal }) {
      const args = buildOsascriptAskArgs(request, getNativeTimeoutSeconds(timeoutMs))
      const result = await runner.run('osascript', args, { timeoutMs, signal })
      return parseOsascriptAskResult(request, result)
    },
    async notify(request, { timeoutMs, signal }) {
      const result = await runner.run('osascript', buildOsascriptNotifyArgs(request), {
        timeoutMs,
        signal,
      })
      assertNotified('osascript', result)
    },
  }
}
