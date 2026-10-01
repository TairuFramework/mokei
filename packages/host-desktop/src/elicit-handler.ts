import type { ElicitResult } from '@mokei/context-protocol'

import type { BackendName, DesktopBackend } from './backends/types.js'
import type { ForcedBackends } from './detect.js'
import { createDialogSurface, isUrlMode, URL_MODE_REASON } from './dialog-surface.js'
import type { DesktopElicitRequest, InputInbox } from './inbox.js'
import { report } from './report.js'
import type { Runner } from './runner.js'

export { defaultCreateBackend, timeoutSecondsOption, untilAbort } from './dialog-surface.js'

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

const CANCEL: ElicitResult = { action: 'cancel' }
const DECLINE: ElicitResult = { action: 'decline' }

/**
 * An abort whose reason is a TaskInputWithdrawnError records the inbox entry as withdrawn;
 * the returned promise still rejects with that reason, and the caller that aborted owns the rejection.
 */
export function createDesktopElicitHandler(
  options: DesktopElicitOptions = {},
): DesktopElicitHandler {
  const mode = options.mode ?? 'dialog'
  if (mode === 'inbox' && options.inbox == null) {
    throw new TypeError('mode "inbox" requires an inbox')
  }
  const { planSteps, showDialogs, notifyAdded, describeSource, disposal, dispose } =
    createDialogSurface(options)

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
    // Promptable when the form maps to dialogs and a dialog backend can show every one of them
    const canPrompt = planSteps(request).ok
    const prompt = canPrompt
      ? (promptSignal: AbortSignal) =>
          showDialogs(
            { ...request, signal: AbortSignal.any([promptSignal, request.signal]) },
            'reject',
          )
      : undefined
    const answer = inbox.add(request, { prompt })
    // A disposed inbox or handler has rejected the request already; nobody needs the notification
    if (!request.signal.aborted && !inbox.disposed && !disposal.signal.aborted) {
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

  return Object.assign(handle, { dispose })
}
