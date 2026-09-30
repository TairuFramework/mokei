import type { Runner, RunResult } from '../runner.js'
import {
  type AskRequest,
  type AskResult,
  type DesktopBackend,
  getDefaultChoiceLabel,
  getNativeTimeoutSeconds,
  requireChoices,
  stripTrailingNewline,
  unexpectedExit,
} from './types.js'

const MARKUP_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/** `g_strcompress` turns `\\` into `\` and drops the backslash of other escapes. */
function escapeCompress(text: string): string {
  return text.replaceAll('\\', '\\\\')
}

/**
 * zenity 4 shows entry `--text` with `gtk_label_set_text_with_mnemonic(g_strcompress(text))`,
 * where `__` is a literal underscore.
 */
function escapeZenityEntryText(text: string): string {
  return escapeCompress(text).replaceAll('_', '__')
}

/** zenity 4 shows list `--text` with `gtk_label_set_markup(g_strcompress(text))`. */
function escapeZenityListText(text: string): string {
  return escapeCompress(text).replace(/[&<>"']/g, (char) => MARKUP_ENTITIES[char] ?? char)
}

// Titles (the dialog heading), column headers, rows and --entry-text are shown as plain text.
function radioListArgs(
  request: AskRequest,
  nativeTimeoutSeconds: number,
  labels: Array<string>,
  selected: string,
): Array<string> {
  return [
    '--list',
    '--radiolist',
    '--title',
    request.title,
    '--text',
    escapeZenityListText(request.text),
    '--column',
    'Pick',
    '--column',
    'Choice',
    '--timeout',
    String(nativeTimeoutSeconds),
    '--',
    ...labels.flatMap((label) => [label === selected ? 'TRUE' : 'FALSE', label]),
  ]
}

export function buildZenityArgs(request: AskRequest, nativeTimeoutSeconds: number): Array<string> {
  switch (request.kind) {
    case 'text':
      return [
        '--entry',
        '--title',
        request.title,
        '--text',
        escapeZenityEntryText(request.text),
        '--entry-text',
        request.default ?? '',
        '--timeout',
        String(nativeTimeoutSeconds),
      ]
    case 'confirm':
      return radioListArgs(
        request,
        nativeTimeoutSeconds,
        ['Yes', 'No'],
        request.default === 'no' ? 'No' : 'Yes',
      )
    case 'choice': {
      const choices = requireChoices(request)
      const labels = choices.map((choice) => choice.label)
      const selected = getDefaultChoiceLabel(choices, request.default)
      return radioListArgs(request, nativeTimeoutSeconds, labels, selected)
    }
  }
}

function parseZenityAnswer(request: AskRequest, stdout: string): AskResult {
  const output = stripTrailingNewline(stdout)
  switch (request.kind) {
    case 'text':
      return { status: 'answered', value: output }
    case 'confirm':
      if (output !== 'Yes' && output !== 'No') {
        throw new Error(`zenity returned an unknown confirm answer: ${output}`)
      }
      return { status: 'answered', value: output === 'Yes' }
    case 'choice': {
      const choice = requireChoices(request).find((c) => c.label === output)
      if (choice == null) {
        throw new Error(`zenity returned an unknown choice: ${output}`)
      }
      return { status: 'answered', value: choice.value }
    }
  }
}

export function parseZenityResult(request: AskRequest, result: RunResult): AskResult {
  if (result.timedOut) {
    return { status: 'timeout' }
  }
  switch (result.code) {
    case 0:
      return parseZenityAnswer(request, result.stdout)
    case 1:
      return { status: 'dismissed' }
    case 5:
      return { status: 'timeout' }
    default:
      throw unexpectedExit('zenity', result)
  }
}

export function createZenityBackend(runner: Runner): DesktopBackend {
  return {
    name: 'zenity',
    async ask(request, { timeoutMs, signal }) {
      const args = buildZenityArgs(request, getNativeTimeoutSeconds(timeoutMs))
      const result = await runner.run('zenity', args, { timeoutMs, signal })
      return parseZenityResult(request, result)
    },
  }
}
