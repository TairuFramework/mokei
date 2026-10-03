import type { RunResult } from '../runner.js'

export type AskKind = 'text' | 'confirm' | 'choice'
export type AskRequest = {
  kind: AskKind
  title: string
  text: string
  /** For `confirm`, `'yes' | 'no'`. For `choice`, the value of the default choice. */
  default?: string
  choices?: Array<{ value: string; label: string }>
}
export type AskResult =
  | { status: 'answered'; value: string | boolean }
  | { status: 'declined' }
  | { status: 'dismissed' }
  | { status: 'timeout' }
export type NotifyRequest = { title: string; message: string; subtitle?: string; sound?: boolean }
export type BackendCallOptions = { timeoutMs: number; signal: AbortSignal }
/**
 * `timeoutMs` and `signal` bound delivery. A backend whose notification outlives delivery
 * (alerter) keeps it until interaction, its native timeout, or `lifetime` aborts, which removes it.
 * Backends without click support ignore `group`, `lifetime` and `onClick`.
 */
export type NotifyCallOptions = BackendCallOptions & {
  /** Notifications sharing a group replace each other. */
  group?: string
  lifetime?: AbortSignal
  /** Called at most once, when the user clicks the notification. */
  onClick?: () => void
}

/** Returned by a backend whose notification outlives delivery. */
export type NotifyDelivery = {
  /** Settles, never rejecting, once the notification process has exited. */
  closed: Promise<void>
}

export type AskBackendName = 'alerter' | 'osascript' | 'zenity'
export type NotifyBackendName = 'alerter' | 'osascript' | 'notify-send'
export type BackendName = AskBackendName | NotifyBackendName

export type DesktopBackend = {
  name: BackendName
  ask?: (request: AskRequest, options: BackendCallOptions) => Promise<AskResult>
  // biome-ignore lint/suspicious/noConfusingVoidType: backends without a live process resolve with nothing
  notify?: (request: NotifyRequest, options: NotifyCallOptions) => Promise<NotifyDelivery | void>
}

/** Native dialog timeout, shorter than the runner timeout so the native timeout reports first. */
export function getNativeTimeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.floor(timeoutMs / 1000) - 5)
}

/** Error for an exit code the adapter's parser does not recognise. */
export function unexpectedExit(name: BackendName, result: RunResult): Error {
  const line = result.stderr.split('\n').find((l) => l.trim() !== '')
  return new Error(line?.trim() ?? `${name} exited with code ${result.code}`)
}

/** Throws unless a notification command exited 0 in time. */
export function assertNotified(name: BackendName, result: RunResult): void {
  if (result.timedOut) {
    throw new Error('Notification delivery timed out')
  }
  if (result.code !== 0) {
    throw unexpectedExit(name, result)
  }
}

/** Removes the single trailing newline that CLI tools append to a printed value. */
export function stripTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

export function requireChoices(request: AskRequest): Array<{ value: string; label: string }> {
  const choices = request.choices
  if (choices == null || choices.length === 0) {
    throw new Error('A choice request needs at least one choice')
  }
  return choices
}

/** The label to preselect: the default choice's label, else the first. */
export function getDefaultChoiceLabel(
  choices: Array<{ value: string; label: string }>,
  defaultValue: string | undefined,
): string {
  const chosen = choices.find((choice) => choice.value === defaultValue) ?? choices[0]
  return chosen?.label ?? ''
}
