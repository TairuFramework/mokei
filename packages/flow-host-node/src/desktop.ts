import type { ElicitResult } from '@mokei/context-protocol'
import type { FlowHost, InboxItem, InboxOutcome } from '@mokei/flow-host'
import { InboxItemNotFoundError } from '@mokei/flow-host'
import type { DesktopElicitRequest, DesktopNotifyOptions } from '@mokei/host-desktop'

import type { createNativeSurface } from './native-surface.js'
import type { InboxSurface, PromptOutcome, SurfaceDelivery } from './surfaces.js'

export type FlowDesktopAdapter = {
  canPrompt(request: DesktopElicitRequest): boolean
  prompt(request: DesktopElicitRequest): Promise<ElicitResult>
  /** Resolves once delivered; `onClick` may fire later, until `signal` aborts. */
  notify(message: string, options?: DesktopNotifyOptions): Promise<void>
  dispose(): Promise<void>
}
export type FlowDesktopController = {
  restored(items: Array<InboxItem>): void
  added(item: InboxItem): void
  settled(item: InboxItem, outcome: InboxOutcome): void
  prompt(id: string, signal: AbortSignal): Promise<PromptOutcome>
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

export function createFlowDesktopController(params: {
  surfaces: Array<InboxSurface>
  native: ReturnType<typeof createNativeSurface>
  host(): FlowHost
  onError(error: unknown): void
}): FlowDesktopController {
  const disposal = new AbortController()
  const represented = new Set<string>()
  const settledIDs = new Set<string>()
  const deliveries = new Map<string, Set<SurfaceDelivery>>()
  const attempts = new Map<string, Set<AbortController>>()
  const owners = new Map<string, ReturnType<typeof Promise.withResolvers<PromptOutcome>>>()
  const operations = new Set<Promise<unknown>>()
  let live = false
  let disposing: Promise<void> | undefined

  function track<T>(operation: Promise<T>): Promise<T> {
    operations.add(operation)
    void operation.then(
      () => operations.delete(operation),
      () => operations.delete(operation),
    )
    return operation
  }
  function begin(id: string) {
    const stop = new AbortController()
    const current = attempts.get(id) ?? new Set<AbortController>()
    current.add(stop)
    attempts.set(id, current)
    return stop
  }
  function pruneSettled(id: string): void {
    if (!attempts.has(id) && !owners.has(id)) settledIDs.delete(id)
  }
  function end(id: string, stop: AbortController): void {
    const current = attempts.get(id)
    current?.delete(stop)
    if (current?.size === 0) attempts.delete(id)
    pruneSettled(id)
  }
  function keep(id: string, delivery: SurfaceDelivery, signal: AbortSignal): void {
    // A surface can finish delivering after its attempt was cancelled.
    if (signal.aborted || settledIDs.has(id)) {
      delivery.close()
      return
    }
    const current = deliveries.get(id) ?? new Set<SurfaceDelivery>()
    current.add(delivery)
    deliveries.set(id, current)
    const forget = () => {
      current.delete(delivery)
      if (current.size === 0) deliveries.delete(id)
    }
    void delivery.closed.then(forget, forget)
  }
  function pending(item: InboxItem, signal: AbortSignal): boolean {
    return !signal.aborted && !settledIDs.has(item.id) && params.host().inbox.get(item.id) != null
  }
  function notify(item: InboxItem, surfaces: Array<InboxSurface>, attention: boolean): void {
    const stop = begin(item.id)
    const signal = AbortSignal.any([stop.signal, disposal.signal])
    const operation = (async () => {
      try {
        if (attention) {
          const attended = await Promise.any(
            params.surfaces.map(async (surface) => {
              if (await surface.isAttended(signal)) return true
              throw new Error('Surface unattended')
            }),
          ).catch(() => false)
          if (attended) return
        }
        for (const surface of surfaces) {
          if (!pending(item, signal)) return
          if (surface.status() !== 'reachable') continue
          const delivery = await surface.notify(item, { signal })
          if (delivery != null) {
            keep(item.id, delivery, signal)
            return
          }
        }
      } catch (error) {
        if (!signal.aborted) params.onError(error)
      } finally {
        end(item.id, stop)
      }
    })()
    track(operation)
  }
  async function prompt(id: string, caller: AbortSignal): Promise<PromptOutcome> {
    disposal.signal.throwIfAborted()
    caller.throwIfAborted()
    if (owners.has(id)) throw new InboxPromptInProgressError(id)
    const item = params.host().inbox.get(id)
    if (item == null) throw new InboxItemNotFoundError(id)
    const outcome = Promise.withResolvers<PromptOutcome>()
    // Settlement must be observed before any surface gets a chance to deliver.
    owners.set(id, outcome)
    const stop = begin(id)
    const signal = AbortSignal.any([stop.signal, caller, disposal.signal])
    const promptDeliveries = new Set<SurfaceDelivery>()
    const abort = () => outcome.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const routing = (async () => {
      for (const surface of params.surfaces) {
        if (signal.aborted) return outcome.promise
        if (!pending(item, signal)) throw new InboxItemNotFoundError(id)
        if (surface.prompt == null) continue
        const delivery = await surface.prompt(item, { signal })
        if (delivery == null) continue
        promptDeliveries.add(delivery)
        keep(id, delivery, signal)
        if (signal.aborted) return outcome.promise
        const settled = await Promise.race([
          outcome.promise.then(() => true),
          delivery.closed.then(() => false),
        ])
        if (settled || signal.aborted) return outcome.promise
        // Target loss only advances to the next surface while the item is pending.
      }
      if (signal.aborted) return outcome.promise
      if (!pending(item, signal)) throw new InboxItemNotFoundError(id)
      throw new DesktopPromptUnavailableError(id)
    })()
    track(routing)
    try {
      return await Promise.race([outcome.promise, routing])
    } finally {
      signal.removeEventListener('abort', abort)
      stop.abort(new Error('Inbox prompt finished'))
      end(id, stop)
      owners.delete(id)
      pruneSettled(id)
      for (const delivery of promptDeliveries) delivery.close()
    }
  }
  return {
    restored(items) {
      if (live || disposal.signal.aborted) return
      for (const item of items) represented.add(item.id)
      live = true
      const only = items[0]
      if (items.length === 1 && only != null) notify(only, [params.native], false)
      else if (items.length > 1) params.native.notifySummary(items.length)
    },
    added(item) {
      if (!live || disposal.signal.aborted || represented.has(item.id)) return
      represented.add(item.id)
      notify(item, params.surfaces, true)
    },
    settled(item, outcome) {
      settledIDs.add(item.id)
      const waiter = owners.get(item.id)
      if (outcome === 'withdrawn') waiter?.reject(new InboxItemNotFoundError(item.id))
      else
        waiter?.resolve({
          action: outcome === 'answered' ? 'accept' : outcome === 'declined' ? 'decline' : 'cancel',
        })
      for (const stop of attempts.get(item.id) ?? [])
        stop.abort(new InboxItemNotFoundError(item.id))
      for (const delivery of deliveries.get(item.id) ?? []) delivery.close()
      deliveries.delete(item.id)
      pruneSettled(item.id)
    },
    prompt,
    dispose() {
      if (disposing != null) return disposing
      disposal.abort(new Error('Flow desktop controller disposed'))
      for (const current of deliveries.values()) for (const delivery of current) delivery.close()
      deliveries.clear()
      disposing = (async () => {
        const results = await Promise.allSettled([
          params.native.dispose(),
          ...[...operations].map((operation) => operation.catch(() => undefined)),
        ])
        const failures = results
          .filter((result) => result.status === 'rejected')
          .flatMap((result) =>
            result.reason instanceof AggregateError ? result.reason.errors : [result.reason],
          )
        if (failures.length > 0) throw new AggregateError(failures, 'Flow desktop disposal failed')
      })()
      return disposing
    },
  }
}
