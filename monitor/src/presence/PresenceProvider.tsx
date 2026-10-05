import { useDidUpdate, useDocumentVisibility, useSetState, useWindowEvent } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import type { MonitorPresenceReceive, MonitorPresenceSend } from '@mokei/host-protocol'
import { useNavigate } from '@tanstack/react-router'
import { createContext, type ReactNode, use, useCallback, useEffect, useRef } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import {
  canNotify as browserCanNotify,
  observeNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
} from './browser-notifications.js'

type PresenceContextValue = {
  activeItemID?: string
  setActiveItem(id?: string): void
  canNotify: boolean
  requestPermission(): Promise<void>
}
type Delivery = { itemID: string; notification?: Notification; toast?: string }
const PresenceContext = createContext<PresenceContextValue | null>(null)

export function usePresence(): PresenceContextValue {
  const context = use(PresenceContext)
  if (context == null) throw new Error('A parent PresenceProvider is required')
  return context
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { client, control, epoch, on, restarted } = useFlow()
  const navigate = useNavigate()
  const [{ activeItemID, canNotify }, setPresence] = useSetState<{
    activeItemID?: string
    canNotify: boolean
  }>({ canNotify: browserCanNotify() })
  const visibility = useDocumentVisibility()
  const lastSentState = useRef<Extract<MonitorPresenceSend, { type: 'state' }> | null>(null)
  const lifecycle = useRef({ stop: () => {}, restore: (_event: PageTransitionEvent) => {} })
  useWindowEvent('pagehide', () => lifecycle.current.stop())
  useWindowEvent('pageshow', (event) => lifecycle.current.restore(event))
  const active = useRef<string | undefined>(undefined)
  const sendState = useRef(() => {})
  const deliveries = useRef(new Map<string, Delivery>())
  const closeDelivery = useCallback((id: string) => {
    const delivery = deliveries.current.get(id)
    if (delivery == null) return
    if (delivery.notification != null) {
      delivery.notification.onclick = null
      delivery.notification.close()
    }
    if (delivery.toast != null) notifications.hide(delivery.toast)
    deliveries.current.delete(id)
  }, [])
  const openItem = useCallback(
    (itemID: string) => {
      return navigate({ href: `/inbox/${encodeURIComponent(itemID)}` })
    },
    [navigate],
  )
  const showToast = useCallback(
    (id: string, itemID: string, title: string, message: string) => {
      notifications.show({
        id,
        title,
        message: (
          <a
            href={`/inbox/${encodeURIComponent(itemID)}`}
            onClick={(event) => {
              event.preventDefault()
              void openItem(itemID).catch(() => {})
            }}>
            {message}
          </a>
        ),
        autoClose: false,
      })
    },
    [openItem],
  )
  const setActiveItem = useCallback(
    (id?: string) => {
      active.current = id
      setPresence({ activeItemID: id })
      sendState.current()
    },
    [setPresence],
  )
  const refreshPermission = useCallback(() => {
    setPresence({ canNotify: browserCanNotify() })
    sendState.current()
  }, [setPresence])
  const requestPermission = useCallback(async () => {
    await requestNotificationPermission()
    refreshPermission()
  }, [refreshPermission])

  // Some browsers do not expose notification permission through Permissions API.
  useWindowEvent('focus', refreshPermission)
  useEffect(() => observeNotificationPermission(refreshPermission), [refreshPermission])
  useDidUpdate(() => {
    sendState.current()
  }, [visibility])
  useEffect(() => {
    return on((event) => {
      if (event.type === 'inbox:settled') {
        for (const [id, delivery] of deliveries.current) {
          if (delivery.itemID === event.data.item.id) closeDelivery(id)
        }
      } else if (event.type === 'inbox:added' && document.visibilityState === 'visible') {
        const id = `inbox:${event.data.id}`
        showToast(
          id,
          event.data.id,
          'New inbox item',
          event.data.kind === 'input' ? event.data.message : 'Approval requested',
        )
        deliveries.current.set(id, { itemID: event.data.id, toast: id })
      }
    })
  }, [on, closeDelivery, showToast])

  useEffect(() => {
    if (restarted) return
    let stopped = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let teardown = () => {}
    function connect() {
      if (stopped) return
      let live = true
      function fail() {
        if (!live || stopped) return
        teardown()
        timer = setTimeout(connect, Math.min(500 * 2 ** failures++, 10_000))
      }
      try {
        // The bridge replaces this parameter with its current attachment ID.
        const channel = client.createChannel('monitor.presence', { param: {} })
        const reader = channel.readable.getReader()
        teardown = () => {
          if (!live) return
          live = false
          sendState.current = () => {}
          channel.close()
          void reader.cancel().catch(() => {})
        }
        const send = (message: MonitorPresenceSend) => {
          if (live && !stopped) void channel.send(message).catch(fail)
        }
        lastSentState.current = null
        const sendCurrentState = () => {
          if (!live || stopped) return
          setPresence({ canNotify: browserCanNotify() })
          const state: Extract<MonitorPresenceSend, { type: 'state' }> = {
            type: 'state',
            // Read live visibility so ping replies cannot overtake state before React commits.
            visible: document.visibilityState === 'visible',
            canNotify: browserCanNotify(),
            ...(active.current == null ? {} : { activeItemID: active.current }),
          }
          const previous = lastSentState.current
          if (
            previous?.visible === state.visible &&
            previous.canNotify === state.canNotify &&
            previous.activeItemID === state.activeItemID
          )
            return
          send(state)
          lastSentState.current = state
        }
        sendState.current = sendCurrentState
        sendCurrentState()
        void channel.catch(fail)
        const existing = new Map(deliveries.current)
        void control.inbox
          .list()
          .then((items) => {
            if (!live || stopped) return
            const pending = new Set(items.map((item) => item.id))
            for (const [id, delivery] of existing) {
              if (deliveries.current.get(id) === delivery && !pending.has(delivery.itemID))
                closeDelivery(id)
            }
          })
          .catch(() => {})
        function receive(message: MonitorPresenceReceive) {
          if (message.type === 'ping') {
            failures = 0
            sendCurrentState()
            send({ type: 'pong', nonce: message.nonce })
            return
          }
          if (message.type === 'withdraw') {
            closeDelivery(message.attemptID)
            return
          }
          if (Date.now() > message.deadline) return
          let shown = false
          let navigation: Promise<void> | undefined
          const delivery: Delivery = { itemID: message.itemID }
          closeDelivery(message.attemptID)
          try {
            const visible = document.visibilityState === 'visible'
            const otherForm = active.current != null && active.current !== message.itemID
            const title = message.type === 'notify' ? message.title : 'Input requested'
            const body =
              message.type === 'notify' ? message.message : 'Open the inbox item to respond'
            if (message.type === 'prompt' && !otherForm) {
              navigation = openItem(message.itemID)
            }
            if (
              (message.type === 'prompt' && otherForm) ||
              (message.type === 'notify' && visible)
            ) {
              showToast(message.attemptID, message.itemID, title, body)
              delivery.toast = message.attemptID
              shown = true
            }
            if (!visible) {
              delivery.notification = showBrowserNotification(message.itemID, title, body, () => {
                void openItem(message.itemID).catch(() => {})
              })
              shown ||= delivery.notification != null
            }
          } catch {
            // A failed display must let the daemon try its next surface.
          }
          deliveries.current.set(message.attemptID, delivery)
          const acknowledge = (shown: boolean) => {
            if (
              deliveries.current.get(message.attemptID) === delivery &&
              Date.now() <= message.deadline
            ) {
              sendCurrentState()
              send({ type: 'ack', attemptID: message.attemptID, shown })
            }
          }
          if (navigation != null) {
            void navigation.then(
              () => acknowledge(shown || document.visibilityState === 'visible'),
              () => acknowledge(false),
            )
          } else {
            acknowledge(shown)
          }
        }
        void (async () => {
          try {
            while (live && !stopped) {
              const result = await reader.read()
              if (result.done) break
              if (live && !stopped) receive(result.value)
            }
            fail()
          } catch {
            fail()
          } finally {
            reader.releaseLock()
          }
        })()
      } catch {
        fail()
      }
    }
    const stop = () => {
      stopped = true
      if (timer != null) clearTimeout(timer)
      teardown()
    }
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted || !stopped) return
      stopped = false
      failures = 0
      connect()
    }
    lifecycle.current = { stop, restore }
    connect()
    return () => {
      stop()
      lifecycle.current = { stop: () => {}, restore: () => {} }
    }
  }, [client, control, epoch, restarted, closeDelivery, openItem, showToast, setPresence])
  useEffect(() => {
    return () => {
      for (const id of deliveries.current.keys()) closeDelivery(id)
    }
  }, [closeDelivery])

  return (
    <PresenceContext value={{ activeItemID, setActiveItem, canNotify, requestPermission }}>
      {children}
    </PresenceContext>
  )
}
