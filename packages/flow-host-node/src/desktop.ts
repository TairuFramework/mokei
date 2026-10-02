import type { ElicitResult } from '@mokei/context-protocol'
import type { FlowHost, InboxItem } from '@mokei/flow-host'
import { InboxAnswerInvalidError, InboxItemNotFoundError } from '@mokei/flow-host'
import type { DesktopElicitRequest } from '@mokei/host-desktop'

export type FlowDesktopAdapter = {
  canPrompt(request: DesktopElicitRequest): boolean
  prompt(request: DesktopElicitRequest): Promise<ElicitResult>
  notify(message: string): Promise<void>
  dispose(): Promise<void>
}
export type FlowDesktopController = {
  restored(items: Array<InboxItem>): void
  added(item: InboxItem): void
  settled(item: InboxItem): void
  prompt(id: string, signal: AbortSignal): Promise<{ action: 'accept' | 'decline' | 'cancel' }>
  dispose(): Promise<void>
}
export class InboxPromptInProgressError extends Error {
  constructor(id: string) {
    super(`Inbox prompt already in progress: ${id}`)
    this.name = 'InboxPromptInProgressError'
  }
}
export class DesktopPromptUnavailableError extends Error {
  constructor(id: string) {
    super(`Desktop prompt is unavailable for inbox item: ${id}`)
    this.name = 'DesktopPromptUnavailableError'
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function createFlowDesktopController(params: {
  adapter?: FlowDesktopAdapter
  notifications: boolean
  host(): FlowHost
  onError(error: unknown): void
}): FlowDesktopController {
  const { adapter } = params
  const disposal = new AbortController()
  const represented = new Set<string>()
  const owners = new Map<string, AbortController>()
  const prompts = new Set<Promise<unknown>>()
  const notifications = new Set<Promise<void>>()
  let live = false
  let disposing: Promise<void> | undefined

  function notify(message: string): void {
    if (!params.notifications || adapter == null || disposal.signal.aborted) return
    // Call now, after represented IDs are recorded, so synchronous additions see the boundary.
    const delivery = (async () => {
      try {
        await adapter.notify(message)
      } catch (error) {
        params.onError(error)
      }
    })()
    notifications.add(delivery)
    void delivery.then(() => notifications.delete(delivery))
  }
  function itemMessage(item: InboxItem): string {
    return item.kind === 'approval' ? 'Flow needs your approval' : 'Flow needs your input'
  }
  async function prompt(id: string, caller: AbortSignal) {
    disposal.signal.throwIfAborted()
    caller.throwIfAborted()
    if (owners.has(id)) throw new InboxPromptInProgressError(id)
    const host = params.host()
    const item = host.inbox.get(id)
    if (item == null) throw new InboxItemNotFoundError(id)
    if (adapter == null) throw new DesktopPromptUnavailableError(id)
    const settlement = new AbortController()
    const stop = AbortSignal.any([caller, settlement.signal, disposal.signal])
    // Ownership precedes all awaits, including the run label lookup.
    owners.set(id, settlement)
    const operation = (async () => {
      const run = await abortable(host.get(item.runID), stop)
      stop.throwIfAborted()
      if (host.inbox.get(id) == null) throw new InboxItemNotFoundError(id)
      const message =
        item.kind === 'approval'
          ? `Run flow "${run?.label ?? item.runID}" with tools: ${item.plan.tools.join(', ') || 'none'}`
          : item.message
      const request: DesktopElicitRequest = {
        key: `Flow: ${run?.label ?? item.runID}`,
        params: {
          message,
          requestedSchema:
            item.kind === 'approval'
              ? {
                  type: 'object',
                  properties: { approve: { type: 'boolean', title: message } },
                  required: ['approve'],
                }
              : item.requestedSchema,
        },
        signal: stop,
      }
      if (!adapter.canPrompt(request)) throw new DesktopPromptUnavailableError(id)
      const result = await abortable(adapter.prompt(request), stop)
      stop.throwIfAborted()
      let action = result.action
      if (item.kind === 'approval' && action === 'accept') {
        if (result.content?.approve === false) action = 'decline'
        else if (result.content?.approve !== true) {
          throw new InboxAnswerInvalidError(['approve: explicit approval boolean required'])
        }
      }
      if (action === 'accept')
        await host.inbox.answer(id, item.kind === 'input' ? result.content : undefined)
      else if (action === 'decline') await host.inbox.decline(id)
      else await host.inbox.cancel(id)
      return { action }
    })()
    prompts.add(operation)
    try {
      return await operation
    } finally {
      owners.delete(id)
      prompts.delete(operation)
    }
  }
  return {
    restored(items) {
      if (live || disposal.signal.aborted) return
      // The snapshot owns these IDs for the daemon lifetime, regardless of delivery or settlement.
      for (const item of items) represented.add(item.id)
      live = true
      const only = items[0]
      if (items.length === 1 && only != null) notify(itemMessage(only))
      else if (items.length > 1) notify(`${items.length} pending prompts`)
    },
    added(item) {
      if (!live || disposal.signal.aborted || represented.has(item.id)) return
      represented.add(item.id)
      notify(itemMessage(item))
    },
    settled(item) {
      owners.get(item.id)?.abort(new InboxItemNotFoundError(item.id))
    },
    prompt,
    dispose() {
      if (disposing != null) return disposing
      disposal.abort(new Error('Flow desktop controller disposed'))
      disposing = (async () => {
        const results = await Promise.allSettled([
          (async () => {
            await adapter?.dispose()
          })(),
          ...notifications,
          ...[...prompts].map((operation) => operation.catch(() => undefined)),
        ])
        const failures = results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason)
        if (failures.length > 0) throw new AggregateError(failures, 'Flow desktop disposal failed')
      })()
      return disposing
    },
  }
}
