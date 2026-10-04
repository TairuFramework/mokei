import type { MonitorPresenceReceive, MonitorPresenceSend } from '@mokei/host-protocol'

export const PRESENCE_REPLY_TIMEOUT_MS = 5_000

export class MonitorURLError extends Error {
  constructor(url: string, options?: ErrorOptions) {
    super(`Invalid monitor URL: ${url}`, options)
    this.name = 'MonitorURLError'
  }
}

export class MonitorAttachmentNotFoundError extends Error {
  constructor(attachmentID: string) {
    super(`Monitor attachment not found: ${attachmentID}`)
    this.name = 'MonitorAttachmentNotFoundError'
  }
}

export function parseMonitorURL(url: string): URL {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]+)\/$/.exec(url)
  if (match == null || Number(match[1]) < 1 || Number(match[1]) > 65535) {
    throw new MonitorURLError(url)
  }
  try {
    return new URL(url)
  } catch (cause) {
    throw new MonitorURLError(url, { cause })
  }
}

export type MonitorTab = { send(message: MonitorPresenceReceive): void; close(): void }
export type MonitorTabState = {
  key: string
  attachmentID: string
  visible: boolean
  canNotify: boolean
  activeItemID?: string
  lastVisibleAt: number
}
export type MonitorPresence = {
  attach(url: string): { attachmentID: string; detach(): void }
  connect(
    attachmentID: string,
    tab: MonitorTab,
  ): {
    receive(message: MonitorPresenceSend): void
    disconnect(): void
  }
  currentURL(): URL | undefined
  status(): 'attended' | 'reachable' | 'unavailable'
  isAttended(signal: AbortSignal): Promise<boolean>
  ping(tabKey: string, signal: AbortSignal): Promise<boolean>
  tabs(): Array<MonitorTabState>
  request(
    tabKey: string,
    message: Extract<MonitorPresenceReceive, { type: 'notify' | 'prompt' }>,
    signal: AbortSignal,
  ): Promise<boolean>
  withdraw(tabKey: string, attemptID: string): void
  onTabClosed(tabKey: string, listener: () => void): () => void
  dispose(): void
}

type TabRecord = {
  state: MonitorTabState
  channel: MonitorTab
  pings: Map<string, (value: boolean) => void>
  attempts: Map<string, (value: boolean) => void>
  listeners: Set<() => void>
}

export function createMonitorPresence(
  params: { now?: () => number; randomID?: () => string } = {},
): MonitorPresence {
  const now = params.now ?? Date.now
  const randomID = params.randomID ?? (() => crypto.randomUUID())
  const attachments = new Map<string, URL>()
  const tabs = new Map<string, TabRecord>()

  function disconnect(key: string, close = false): void {
    const tab = tabs.get(key)
    if (tab == null) return
    tabs.delete(key)
    for (const finish of tab.pings.values()) finish(false)
    for (const finish of tab.attempts.values()) finish(false)
    for (const listener of tab.listeners) listener()
    tab.listeners.clear()
    if (close) tab.channel.close()
  }

  function waitForReply(
    tab: TabRecord,
    pending: Map<string, (value: boolean) => void>,
    key: string,
    message: MonitorPresenceReceive,
    signal: AbortSignal,
    onTimeout?: () => void,
  ): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        pending.delete(key)
        resolve(value)
      }
      const abort = () => finish(false)
      const timer = setTimeout(() => {
        onTimeout?.()
        finish(false)
      }, PRESENCE_REPLY_TIMEOUT_MS)
      pending.set(key, finish)
      signal.addEventListener('abort', abort, { once: true })
      try {
        tab.channel.send(message)
      } catch {
        disconnect(tab.state.key)
      }
    })
  }

  function ping(tabKey: string, signal: AbortSignal): Promise<boolean> {
    const tab = tabs.get(tabKey)
    if (tab == null) return Promise.resolve(false)
    const nonce = randomID()
    return waitForReply(tab, tab.pings, nonce, { type: 'ping', nonce }, signal, () => {
      tab.state.visible = false
      // Reuse failed liveness until a fresh state, avoiding a second fallback timeout.
      tab.state.canNotify = false
    })
  }

  return {
    attach(url) {
      const parsed = parseMonitorURL(url)
      const attachmentID = randomID()
      attachments.set(attachmentID, parsed)
      return {
        attachmentID,
        detach() {
          if (!attachments.delete(attachmentID)) return
          for (const [key, tab] of tabs) {
            if (tab.state.attachmentID === attachmentID) disconnect(key, true)
          }
        },
      }
    },
    connect(attachmentID, channel) {
      if (!attachments.has(attachmentID)) throw new MonitorAttachmentNotFoundError(attachmentID)
      const key = randomID()
      const tab: TabRecord = {
        state: { key, attachmentID, visible: false, canNotify: false, lastVisibleAt: 0 },
        channel,
        pings: new Map(),
        attempts: new Map(),
        listeners: new Set(),
      }
      tabs.set(key, tab)
      return {
        receive(message) {
          if (!tabs.has(key)) return
          if (message.type === 'state') {
            tab.state.visible = message.visible
            tab.state.canNotify = message.canNotify
            tab.state.activeItemID = message.activeItemID
            if (message.visible) tab.state.lastVisibleAt = now()
          } else if (message.type === 'pong') {
            tab.pings.get(message.nonce)?.(true)
          } else {
            tab.attempts.get(message.attemptID)?.(message.shown)
          }
        },
        disconnect: () => disconnect(key),
      }
    },
    currentURL: () => [...attachments.values()].at(-1),
    status() {
      let reachable = false
      for (const { state } of tabs.values()) {
        if (state.visible) return 'attended'
        if (state.canNotify) reachable = true
      }
      return reachable ? 'reachable' : 'unavailable'
    },
    isAttended(signal) {
      const visible = [...tabs.values()].filter((tab) => tab.state.visible)
      if (visible.length === 0) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        let remaining = visible.length
        for (const tab of visible) {
          void ping(tab.state.key, signal).then((attended) => {
            remaining--
            if (attended) resolve(true)
            else if (remaining === 0) resolve(false)
          })
        }
      })
    },
    ping,
    tabs: () => [...tabs.values()].map((tab) => ({ ...tab.state })),
    request(tabKey, message, signal) {
      const tab = tabs.get(tabKey)
      return tab == null
        ? Promise.resolve(false)
        : waitForReply(tab, tab.attempts, message.attemptID, message, signal)
    },
    withdraw(tabKey, attemptID) {
      tabs.get(tabKey)?.channel.send({ type: 'withdraw', attemptID })
    },
    onTabClosed(tabKey, listener) {
      const tab = tabs.get(tabKey)
      if (tab == null) listener()
      else tab.listeners.add(listener)
      return () => tab?.listeners.delete(listener)
    },
    dispose() {
      attachments.clear()
      for (const key of tabs.keys()) disconnect(key, true)
    },
  }
}
