import type { InboxItem } from '@mokei/flow-host'

import { inboxItemMessage } from './inbox-message.js'
import type { MonitorPresence, MonitorTabState } from './monitor-presence.js'
import { PRESENCE_REPLY_TIMEOUT_MS } from './monitor-presence.js'
import type { InboxSurface, SurfaceDelivery } from './surfaces.js'

export function createMonitorSurface(
  presence: MonitorPresence,
  params: { randomID?: () => string; now?: () => number } = {},
): InboxSurface {
  const randomID = params.randomID ?? (() => crypto.randomUUID())
  const now = params.now ?? Date.now

  function withdraw(tabKey: string, attemptID: string): void {
    try {
      presence.withdraw(tabKey, attemptID)
    } catch {
      // A broken channel must not prevent fallback or delivery cleanup.
    }
  }

  function latestNotificationTab(tabs: Array<MonitorTabState>): MonitorTabState | undefined {
    return tabs.filter((tab) => tab.canNotify).sort((a, b) => b.lastVisibleAt - a.lastVisibleAt)[0]
  }

  async function verify(tab: MonitorTabState, attemptID: string, signal: AbortSignal) {
    const alive = await presence.ping(tab.key, signal)
    if (!alive && !signal.aborted) withdraw(tab.key, attemptID)
    return alive && !signal.aborted
  }

  function delivery(tabKey: string, attemptID: string, signal: AbortSignal): SurfaceDelivery {
    const { promise: closed, resolve } = Promise.withResolvers<void>()
    let finished = false
    let unsubscribe = () => {}
    function finish(): void {
      if (finished) return
      finished = true
      unsubscribe()
      signal.removeEventListener('abort', close)
      resolve()
    }
    function close(): void {
      if (finished) return
      withdraw(tabKey, attemptID)
      finish()
    }
    signal.addEventListener('abort', close, { once: true })
    unsubscribe = presence.onTabClosed(tabKey, finish)
    if (signal.aborted) close()
    return { close, closed }
  }

  async function request(
    type: 'notify' | 'prompt',
    tab: MonitorTabState,
    item: InboxItem,
    attemptID: string,
    signal: AbortSignal,
  ): Promise<SurfaceDelivery | null> {
    if (signal.aborted) return null
    const fields = { attemptID, deadline: now() + PRESENCE_REPLY_TIMEOUT_MS, itemID: item.id }
    const shown = await presence.request(
      tab.key,
      type === 'notify'
        ? { type, ...fields, title: 'mokei', message: inboxItemMessage(item) }
        : { type, ...fields },
      signal,
    )
    if (!shown || signal.aborted) {
      withdraw(tab.key, attemptID)
      return null
    }
    return delivery(tab.key, attemptID, signal)
  }

  return {
    name: 'monitor',
    status: () => presence.status(),
    isAttended: (signal) => presence.isAttended(signal),
    async notify(item, { signal }) {
      if (signal.aborted) return null
      const tab = latestNotificationTab(presence.tabs())
      if (tab == null) return null
      const attemptID = randomID()
      if (!(await verify(tab, attemptID, signal))) return null
      return request('notify', tab, item, attemptID, signal)
    },
    async prompt(item, { signal }) {
      if (signal.aborted) return null
      const attemptID = randomID()
      const tried = new Set<string>()
      for (const tab of presence.tabs().filter((tab) => tab.visible)) {
        tried.add(tab.key)
        if (await verify(tab, attemptID, signal)) {
          return request('prompt', tab, item, attemptID, signal)
        }
        if (signal.aborted) return null
      }
      const tab = latestNotificationTab(presence.tabs().filter((tab) => !tried.has(tab.key)))
      if (tab == null || !(await verify(tab, attemptID, signal))) return null
      return request('prompt', tab, item, attemptID, signal)
    },
  }
}
