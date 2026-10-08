import type { Client } from '@enkaku/client'
import type { HostEvent, HostInfoResult, Protocol } from '@mokei/host-protocol'
import { createContext, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { createHostClient } from './client.js'

export type HostConnection = {
  client: Client<Protocol>
  epoch: number
  connected: boolean
  restarted: boolean
  subscribe<T extends HostEvent['type']>(
    types: Array<T>,
    listener: (event: Extract<HostEvent, { type: T }>, epoch: number) => void,
  ): () => void
  info: HostInfoResult | undefined
}

export const HostConnectionContext = createContext<HostConnection | null>(null)

type Subscriber = { types: Set<HostEvent['type']>; listener(event: HostEvent, epoch: number): void }

export function HostConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HostConnection | null>(null)
  const subscribers = useRef(new Set<Subscriber>())
  const subscribe = useCallback<HostConnection['subscribe']>((types, listener) => {
    const subscriber: Subscriber = {
      types: new Set(types),
      listener: listener as Subscriber['listener'],
    }
    subscribers.current.add(subscriber)
    return () => {
      subscribers.current.delete(subscriber)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let restarted = false
    let epoch = 0
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let teardown = () => {}

    function connect() {
      if (stopped || restarted) return
      const connectionEpoch = epoch
      let active = true
      const abort = new AbortController()
      let closeStream = () => {}
      const off: Array<() => void> = []
      const cleanup = () => {
        if (!active) return
        active = false
        for (const remove of off) remove()
        abort.abort()
        closeStream()
        void client.dispose().catch(() => {})
      }
      function fail() {
        if (!active || stopped || restarted) return
        setState((value) => value && { ...value, connected: false, info: undefined })
        cleanup()
        timer = setTimeout(
          () => {
            epoch++
            connect()
          },
          Math.min(500 * 2 ** failures++, 10_000),
        )
      }
      function restart() {
        if (stopped || restarted) return
        restarted = true
        if (timer != null) clearTimeout(timer)
        setState((value) => value && { ...value, connected: false, restarted: true })
        teardown()
      }
      const observedFetch: typeof fetch = async (input, init) => {
        try {
          const response = await globalThis.fetch(input, init)
          if (response.status === 403) restart()
          else if (!response.ok) fail()
          return response
        } catch (error) {
          if (!init?.signal?.aborted) fail()
          throw error
        }
      }
      const url = import.meta.env.VITE_API_URL || `${window.location.origin}/api`
      const client = createHostClient(url, observedFetch)
      teardown = cleanup
      setState({ client, epoch, connected: false, restarted: false, subscribe, info: undefined })
      off.push(client.events.on('transportError', fail), client.events.on('writeFailed', fail))
      client.signal.addEventListener('abort', fail)
      off.push(() => client.signal.removeEventListener('abort', fail))

      // Open before info: its reply is the barrier confirming the subscription is registered.
      const stream = client.createStream('events', { signal: abort.signal })
      closeStream = () => stream.close()
      void stream.catch(fail)
      let latestStatus: HostInfoResult['flowService'] | undefined
      let ready = false
      const buffered: Array<HostEvent> = []
      const dispatch = (event: HostEvent) => {
        for (const subscriber of subscribers.current) {
          if (!active) break
          if (subscriber.types.has(event.type)) subscriber.listener(event, connectionEpoch)
        }
      }
      void (async () => {
        const reader = stream.readable.getReader()
        try {
          while (active) {
            const result = await reader.read()
            // Cleanup can happen while read is pending, including in the previous epoch.
            if (!active) break
            if (result.done) {
              fail()
              break
            }
            const event = result.value
            if (event.type === 'service:status') {
              latestStatus = event.data.status
              setState(
                (value) =>
                  value && {
                    ...value,
                    info: value.info && { ...value.info, flowService: event.data.status },
                  },
              )
            }
            if (ready) dispatch(event)
            else buffered.push(event)
          }
        } catch {
          fail()
        } finally {
          reader.releaseLock()
        }
      })()
      void client
        .request('info', { signal: abort.signal })
        .then((info) => {
          if (!active) return
          failures = 0
          ready = true
          setState(
            (value) =>
              value && {
                ...value,
                connected: true,
                info: latestStatus == null ? info : { ...info, flowService: latestStatus },
              },
          )
          for (const event of buffered) dispatch(event)
          buffered.length = 0
        })
        .catch(fail)
    }
    function stop() {
      stopped = true
      if (timer != null) clearTimeout(timer)
      teardown()
    }
    function onPageHide() {
      stop()
      setState((value) => value && { ...value, connected: false })
    }
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted || restarted) return
      stop()
      stopped = false
      failures = 0
      epoch++
      connect()
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    connect()
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      stop()
    }
  }, [subscribe])

  return state == null ? null : (
    <HostConnectionContext value={state}>{children}</HostConnectionContext>
  )
}
