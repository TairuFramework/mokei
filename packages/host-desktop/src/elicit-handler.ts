import type { ElicitResult } from '@mokei/context-protocol'

import { createAlerterBackend } from './backends/alerter.js'
import { createNotifySendBackend } from './backends/notify-send.js'
import { createOsascriptBackend } from './backends/osascript.js'
import type {
  AskBackendName,
  AskRequest,
  AskResult,
  BackendName,
  DesktopBackend,
} from './backends/types.js'
import { createZenityBackend } from './backends/zenity.js'
import { askBackendFor, createDetector, type ForcedBackends } from './detect.js'
import { type FieldPlan, type FormParams, planForm, withViolation } from './form.js'
import type { DesktopElicitRequest, InputInbox } from './inbox.js'
import { report } from './report.js'
import { createRunner, type Runner } from './runner.js'

export type DesktopElicitOptions = {
  mode?: 'dialog' | 'inbox'
  inbox?: InputInbox
  timeoutSeconds?: number
  maxTimeoutSeconds?: number
  appName?: string
  describeSource?: (request: DesktopElicitRequest) => string
  notificationPromptPreview?: boolean
  backends?: ForcedBackends
  runner?: Runner
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  onUnsupported?: (reason: string) => void
  /** Test seam: replaces adapter construction. */
  createBackend?: (name: BackendName, runner: Runner) => DesktopBackend
}

export type DesktopElicitHandler = ((request: DesktopElicitRequest) => Promise<ElicitResult>) & {
  dispose(): Promise<void>
}

const DEFAULT_TIMEOUT_SECONDS = 90
const DEFAULT_MAX_TIMEOUT_SECONDS = 600
const MAX_ATTEMPTS = 3
const NOTIFY_TIMEOUT_MS = 5000
const PREVIEW_LENGTH = 200
const URL_MODE_REASON = 'URL mode elicitation is not supported by desktop dialogs'
const DISPOSED_MESSAGE = 'Desktop elicit handler disposed'

const CANCEL: ElicitResult = { action: 'cancel' }
const DECLINE: ElicitResult = { action: 'decline' }

/** One dialog to show: a form field, or the single confirm of an empty form. */
type Step = { ask: AskRequest; backend: AskBackendName; field?: FieldPlan }

type Content = NonNullable<ElicitResult['content']>

function defaultCreateBackend(appName: string) {
  return (name: BackendName, runner: Runner): DesktopBackend => {
    switch (name) {
      case 'alerter':
        return createAlerterBackend(runner)
      case 'osascript':
        return createOsascriptBackend(runner)
      case 'zenity':
        return createZenityBackend(runner)
      case 'notify-send':
        return createNotifySendBackend(runner, appName)
    }
  }
}

function isUrlMode(params: DesktopElicitRequest['params']): boolean {
  return !('requestedSchema' in params) || params.mode === 'url'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Settles with the promise, or rejects with the signal's reason as soon as it aborts. */
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** FIFO gate allowing one open dialog at a time. */
function createDialogQueue() {
  let busy = false
  const waiting: Array<() => void> = []

  function release(): void {
    const next = waiting.shift()
    if (next == null) {
      busy = false
    } else {
      next()
    }
  }

  function releaseOnce(): () => void {
    let released = false
    return () => {
      if (!released) {
        released = true
        release()
      }
    }
  }

  /** Resolves with a release function once this caller's turn comes; rejects on abort. */
  function acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      return Promise.reject(signal.reason)
    }
    if (!busy) {
      busy = true
      return Promise.resolve(releaseOnce())
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort)
        resolve(releaseOnce())
      }
      const onAbort = () => {
        const index = waiting.indexOf(grant)
        if (index !== -1) {
          waiting.splice(index, 1)
        }
        reject(signal.reason)
      }
      waiting.push(grant)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  return { acquire }
}

export function createDesktopElicitHandler(
  options: DesktopElicitOptions = {},
): DesktopElicitHandler {
  const mode = options.mode ?? 'dialog'
  if (mode === 'inbox' && options.inbox == null) {
    throw new TypeError('mode "inbox" requires an inbox')
  }
  const budgetMs =
    Math.min(
      options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      options.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS,
    ) * 1000
  const appName = options.appName ?? 'mokei'
  const describeSource = options.describeSource ?? ((r) => r.key ?? 'A server')
  const ownsRunner = options.runner == null
  const runner = options.runner ?? createRunner()
  const createBackend = options.createBackend ?? defaultCreateBackend(appName)
  const detect = createDetector({
    platform: options.platform ?? process.platform,
    env: options.env ?? process.env,
    forced: options.backends,
  })
  const backends = new Map<BackendName, DesktopBackend>()
  const queue = createDialogQueue()
  const disposal = new AbortController()
  let disposing: Promise<void> | undefined

  function getBackend(name: BackendName): DesktopBackend {
    let backend = backends.get(name)
    if (backend == null) {
      backend = createBackend(name, runner)
      backends.set(name, backend)
    }
    return backend
  }

  /** Plans every dialog up front so an unsupported request declines before any dialog opens. */
  function planSteps(
    request: DesktopElicitRequest,
  ): { ok: true; steps: Array<Step> } | { ok: false; reason: string } {
    const params = request.params
    if (isUrlMode(params)) {
      return { ok: false, reason: URL_MODE_REASON }
    }
    const source = describeSource(request)
    const plan = planForm(params as FormParams, { appName, source })
    if (!plan.ok) {
      return plan
    }
    const asks: Array<{ ask: AskRequest; field?: FieldPlan }> =
      plan.fields.length === 0
        ? [
            {
              ask: {
                kind: 'confirm',
                title: appName,
                text: [source, params.message]
                  .filter((line) => line != null && line !== '')
                  .join('\n'),
              },
            },
          ]
        : plan.fields.map((field) => ({ ask: field.ask, field }))
    const { availability, selection } = detect()
    const steps: Array<Step> = []
    for (const { ask, field } of asks) {
      const chosen = askBackendFor(ask, selection, availability)
      if (!chosen.ok) {
        return chosen
      }
      steps.push({ ask, backend: chosen.name, field })
    }
    return { ok: true, steps }
  }

  function askOnce(
    step: Step,
    ask: AskRequest,
    signal: AbortSignal,
    deadline: number,
  ): Promise<AskResult> {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return Promise.resolve({ status: 'timeout' })
    }
    const backend = getBackend(step.backend)
    if (backend.ask == null) {
      throw new Error(`${step.backend} cannot show dialogs`)
    }
    return untilAbort(backend.ask(ask, { timeoutMs: remaining, signal }), signal)
  }

  async function runSteps(
    steps: Array<Step>,
    signal: AbortSignal,
    deadline: number,
  ): Promise<ElicitResult> {
    const content: Content = {}
    for (const step of steps) {
      let ask = step.ask
      let answered = false
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !answered; attempt++) {
        const result = await askOnce(step, ask, signal, deadline)
        if (result.status === 'declined') {
          return DECLINE
        }
        if (result.status !== 'answered') {
          return CANCEL
        }
        if (step.field == null) {
          // The single confirm of an empty form
          return result.value === true ? { action: 'accept', content: {} } : CANCEL
        }
        const converted = step.field.toValue(result.value)
        if (converted.ok) {
          if (converted.value !== undefined) {
            content[step.field.name] = converted.value
          }
          answered = true
        } else {
          ask = withViolation(step.ask, converted.violation)
        }
      }
      if (!answered) {
        return CANCEL
      }
    }
    return { action: 'accept', content }
  }

  /**
   * Blocking path: queues the request and shows its dialogs. The budget starts at this call
   * and covers queue time, every field and every retry. Rejects with `request.signal.reason`
   * on abort; budget expiry gives `cancel`.
   */
  async function showDialogs(request: DesktopElicitRequest): Promise<ElicitResult> {
    const { signal } = request
    signal.throwIfAborted()
    // A fresh error per later call, so callers never share one instance
    if (disposal.signal.aborted) {
      throw new Error(DISPOSED_MESSAGE)
    }
    const planned = planSteps(request)
    if (!planned.ok) {
      report(options.onUnsupported, planned.reason)
      return DECLINE
    }

    const deadline = Date.now() + budgetMs
    const budget = new AbortController()
    const timer = setTimeout(() => budget.abort(), budgetMs)
    const stop = AbortSignal.any([signal, budget.signal, disposal.signal])
    try {
      const release = await queue.acquire(stop)
      try {
        return await runSteps(planned.steps, stop, deadline)
      } finally {
        release()
      }
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason
      }
      if (disposal.signal.aborted) {
        throw disposal.signal.reason
      }
      if (budget.signal.aborted) {
        return CANCEL
      }
      // A backend failure (unknown exit code, missing binary...) ends the request as cancel
      report(options.onUnsupported, messageOf(error))
      return CANCEL
    } finally {
      clearTimeout(timer)
    }
  }

  /** Best-effort notification about a new inbox entry; failures are reported, never thrown. */
  async function notifyAdded(request: DesktopElicitRequest, source: string): Promise<void> {
    const { selection } = detect()
    if (selection.notify == null) {
      report(
        options.onUnsupported,
        `Input notification failed: ${selection.notifyProblem ?? 'No notification backend is available'}`,
      )
      return
    }
    let message = `${source} needs your input`
    if (options.notificationPromptPreview === true) {
      message += `: ${request.params.message.slice(0, PREVIEW_LENGTH)}`
    }
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort(new Error('Notification delivery timed out'))
    }, NOTIFY_TIMEOUT_MS)
    const signal = AbortSignal.any([timeout.signal, disposal.signal])
    try {
      const backend = getBackend(selection.notify.name)
      if (backend.notify == null) {
        throw new Error(`${backend.name} cannot show notifications`)
      }
      await untilAbort(
        backend.notify({ title: appName, message }, { timeoutMs: NOTIFY_TIMEOUT_MS, signal }),
        signal,
      )
    } catch (error) {
      if (!disposal.signal.aborted) {
        report(options.onUnsupported, `Input notification failed: ${messageOf(error)}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Inbox path: adds a pending entry, starts a notification and returns the entry's answer. */
  function addToInbox(inbox: InputInbox, request: DesktopElicitRequest): Promise<ElicitResult> {
    if (isUrlMode(request.params)) {
      report(options.onUnsupported, URL_MODE_REASON)
      return Promise.resolve(DECLINE)
    }
    const source = describeSource(request)
    if (!inbox.hasAnswerSurface) {
      report(
        options.onUnsupported,
        `No input answer surface is registered; cancelling input from ${source}`,
      )
      return Promise.resolve(CANCEL)
    }
    const canPrompt = planForm(request.params as FormParams, { appName, source }).ok
    const prompt = canPrompt
      ? (promptSignal: AbortSignal) =>
          showDialogs({ ...request, signal: AbortSignal.any([promptSignal, request.signal]) })
      : undefined
    const answer = inbox.add(request, { prompt })
    if (!request.signal.aborted) {
      // Delivery never holds up the answer; failures are reported by notifyAdded
      void notifyAdded(request, source)
    }
    return answer
  }

  async function handle(request: DesktopElicitRequest): Promise<ElicitResult> {
    if (mode === 'inbox' && options.inbox != null) {
      return await addToInbox(options.inbox, request)
    }
    return await showDialogs(request)
  }

  function dispose(): Promise<void> {
    if (disposing == null) {
      disposal.abort(new Error(DISPOSED_MESSAGE))
      disposing = ownsRunner ? runner.dispose() : Promise.resolve()
    }
    return disposing
  }

  return Object.assign(handle, { dispose })
}
