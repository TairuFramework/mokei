import type { ElicitResult } from '@mokei/context-protocol'
import { elicitRequestFormParams } from '@mokei/context-protocol'
import type { FlowHost, InboxItem } from '@mokei/flow-host'
import { InboxAnswerInvalidError, InboxItemNotFoundError } from '@mokei/flow-host'
import type { DesktopElicitRequest, DesktopNotifyOptions } from '@mokei/host-desktop'
import { raceSignal, settleAll } from '@sozai/async'
import { createValidator } from '@sozai/schema'

import {
  DesktopPromptUnavailableError,
  type FlowDesktopAdapter,
  InboxPromptInProgressError,
} from './desktop.js'
import { inboxItemMessage } from './inbox-message.js'
import type { InboxSurface, SurfaceDelivery } from './surfaces.js'

const QUIET_CLICK_ERRORS = new Set([
  'InboxPromptInProgressError',
  'DesktopPromptUnavailableError',
  'InboxItemNotFoundError',
])

function createRequestedSchemaValidator() {
  return createValidator(elicitRequestFormParams.properties.requestedSchema)
}

let requestedSchemaValidator: ReturnType<typeof createRequestedSchemaValidator> | undefined

export function createNativeSurface(params: {
  adapter?: FlowDesktopAdapter
  notifications: boolean
  host(): FlowHost
  monitorURL(): URL | undefined
  openURL?(url: string): Promise<void>
  onError(error: unknown): void
}): InboxSurface & { notifySummary(count: number): void; dispose(): Promise<void> } {
  const { adapter } = params
  const disposal = new AbortController()
  const deliveries = new Set<SurfaceDelivery>()
  const operations = new Set<Promise<unknown>>()
  const owners = new Set<string>()
  let disposing: Promise<void> | undefined

  function track<T>(operation: Promise<T>): Promise<T> {
    operations.add(operation)
    void operation.then(
      () => operations.delete(operation),
      () => operations.delete(operation),
    )
    return operation
  }
  function delivery(signal: AbortSignal) {
    const stop = new AbortController()
    const closed = Promise.withResolvers<void>()
    let finished = false
    const value: SurfaceDelivery = {
      closed: closed.promise,
      close() {
        finish()
      },
    }
    function finish(error?: unknown): void {
      if (finished) return
      finished = true
      stop.abort(error ?? new Error('Native delivery closed'))
      signal.removeEventListener('abort', abort)
      disposal.signal.removeEventListener('abort', abort)
      deliveries.delete(value)
      if (error == null) closed.resolve()
      else closed.reject(error)
    }
    function abort(): void {
      finish()
    }
    deliveries.add(value)
    signal.addEventListener('abort', abort, { once: true })
    disposal.signal.addEventListener('abort', abort, { once: true })
    // Errors are observed by the controller, or the click operation.
    void closed.promise.catch(() => undefined)
    if (signal.aborted || disposal.signal.aborted) finish()
    return { value, signal: stop.signal, finish }
  }
  async function prompt(
    item: InboxItem,
    { signal }: { signal: AbortSignal },
  ): Promise<SurfaceDelivery | null> {
    if (signal.aborted || disposal.signal.aborted) return null
    if (owners.has(item.id)) throw new InboxPromptInProgressError({ itemID: item.id })
    if (adapter == null) return null
    const host = params.host()
    if (host.inbox.get(item.id) == null) throw new InboxItemNotFoundError({ itemID: item.id })
    owners.add(item.id)
    const current = delivery(signal)
    const release = () => owners.delete(item.id)
    void current.value.closed.then(release, release)
    let unsubscribe = () => {}
    try {
      const run = await raceSignal(host.get(item.runID), current.signal)
      current.signal.throwIfAborted()
      if (host.inbox.get(item.id) == null) throw new InboxItemNotFoundError({ itemID: item.id })
      const message =
        item.kind === 'approval'
          ? `Run flow "${run?.label ?? item.runID}" with tools: ${item.plan.tools.join(', ') || 'none'}`
          : item.message
      requestedSchemaValidator ??= createRequestedSchemaValidator()
      const validated = requestedSchemaValidator(
        item.kind === 'approval'
          ? {
              type: 'object',
              properties: { approve: { type: 'boolean', title: message } },
              required: ['approve'],
            }
          : item.requestedSchema,
      )
      if (validated.issues) {
        current.finish()
        return null
      }
      const request: DesktopElicitRequest = {
        key: `Flow: ${run?.label ?? item.runID}`,
        params: { message, requestedSchema: validated.value },
        signal: current.signal,
      }
      if (!adapter.canPrompt(request)) {
        current.finish()
        return null
      }
      unsubscribe = host.events.on('inbox:settled', ({ item: settled }) => {
        if (settled.id === item.id) current.finish()
      })
      const nativePrompt = track(adapter.prompt(request))
      const operation = (async () => {
        try {
          const result: ElicitResult = await raceSignal(nativePrompt, current.signal)
          current.signal.throwIfAborted()
          let action = result.action
          if (item.kind === 'approval' && action === 'accept') {
            if (result.content?.approve === false) action = 'decline'
            else if (result.content?.approve !== true)
              throw new InboxAnswerInvalidError({
                issues: ['approve: explicit approval boolean required'],
              })
          }
          if (action === 'accept')
            await host.inbox.answer(item.id, item.kind === 'input' ? result.content : undefined)
          else if (action === 'decline') await host.inbox.decline(item.id)
          else await host.inbox.cancel(item.id)
        } catch (error) {
          if (!current.signal.aborted) current.finish(error)
        } finally {
          unsubscribe()
        }
      })()
      track(operation)
      return current.value
    } catch (error) {
      current.finish()
      unsubscribe()
      throw error
    }
  }
  function click(item: InboxItem, signal: AbortSignal): void {
    if (signal.aborted || disposal.signal.aborted) return
    const operation = (async () => {
      const url = params.monitorURL()
      if (url != null)
        await params.openURL?.(new URL(`inbox/${encodeURIComponent(item.id)}`, url).href)
      else {
        const shown = await prompt(item, { signal })
        if (shown == null) throw new DesktopPromptUnavailableError({ itemID: item.id })
        await shown.closed
      }
    })()
    track(operation).catch((error: unknown) => {
      if (
        !signal.aborted &&
        !disposal.signal.aborted &&
        !(error instanceof Error && QUIET_CLICK_ERRORS.has(error.name))
      )
        params.onError(error)
    })
  }
  async function notify(
    item: InboxItem,
    { signal }: { signal: AbortSignal },
  ): Promise<SurfaceDelivery | null> {
    if (!params.notifications || adapter == null || signal.aborted || disposal.signal.aborted)
      return null
    const current = delivery(signal)
    try {
      await track(
        adapter.notify(inboxItemMessage(item), {
          group: `mokei-inbox-${item.id}`,
          signal: current.signal,
          onClick: () => click(item, current.signal),
        }),
      )
      return current.value
    } catch (error) {
      current.finish()
      params.onError(error)
      return null
    }
  }
  return {
    name: 'native',
    status: () => {
      return adapter != null && params.notifications && !disposal.signal.aborted
        ? 'reachable'
        : 'unavailable'
    },
    isAttended: async () => false,
    notify,
    prompt,
    notifySummary(count) {
      if (!params.notifications || adapter == null || disposal.signal.aborted) return
      const current = delivery(disposal.signal)
      const options: DesktopNotifyOptions = {
        group: 'mokei-inbox-pending',
        signal: current.signal,
        onClick: () => {
          if (current.signal.aborted) return
          const operation = (async () => {
            const url = params.monitorURL()
            if (url != null) await params.openURL?.(new URL('inbox', url).href)
          })()
          track(operation).catch(params.onError)
        },
      }
      const operation = (async () => {
        await adapter.notify(`${count} pending prompts`, options)
      })()
      track(operation).catch(params.onError)
    },
    dispose() {
      if (disposing != null) return disposing
      disposal.abort(new Error('Native surface disposed'))
      for (const current of deliveries) current.close()
      const adapterDisposal = (async () => {
        await adapter?.dispose()
      })()
      disposing = settleAll(
        [
          () => adapterDisposal,
          ...[...operations].map((operation) => () => operation.catch(() => undefined)),
        ],
        'Native surface disposal failed',
      )
      return disposing
    },
  }
}
