import { setTimeout as sleep } from 'node:timers/promises'
import type { Monitor } from '@mokei/host-monitor'
import type { MonitorPresenceReceive, MonitorPresenceSend } from '@mokei/host-protocol'

export async function connectTab(
  monitor: Monitor,
  options: { visible: boolean; canNotify: boolean; pong?: boolean; ack?: boolean; shown?: boolean },
) {
  const controller = new AbortController()
  let rid = crypto.randomUUID()
  let connections = 0
  let sessionID: string | null = null
  const messages: Array<MonitorPresenceReceive> = []
  const failures: Array<unknown> = []
  const completedReplies: Array<MonitorPresenceSend> = []
  async function post(payload: unknown) {
    const response = await fetch(new URL('api', monitor.url), {
      method: 'POST',
      headers: {
        Origin: new URL(monitor.url).origin,
        Authorization: `Bearer ${monitor.token}`,
        'Content-Type': 'application/json',
        ...(sessionID == null ? {} : { 'enkaku-session-id': sessionID }),
      },
      body: JSON.stringify({ header: { typ: 'JWT', alg: 'none' }, payload }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Tab HTTP ${response.status}: ${await response.text()}`)
    return response
  }
  const send = async (value: MonitorPresenceSend) => {
    await post({ typ: 'send', prc: 'monitor.presence', rid, val: value })
  }
  async function barrier() {
    // This request follows prior sends through the monitor's shared daemon socket.
    const response = await post({ typ: 'request', prc: 'info', rid: crypto.randomUUID() })
    const result = await response.json()
    if (result.payload.typ === 'error') throw new Error(result.payload.msg)
  }
  async function open() {
    // A replaced bridge cannot reuse the ended SSE session. Keep the page/client object.
    sessionID = null
    rid = crypto.randomUUID()
    const response = await post({
      typ: 'channel',
      prc: 'monitor.presence',
      rid,
      prm: { attachmentID: 'bridge-stamps-this' },
    })
    sessionID = response.headers.get('enkaku-session-id')
    if (sessionID == null || response.body == null) {
      await response.body?.cancel()
      throw new Error('Expected a presence SSE session')
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    try {
      await send({ type: 'state', visible: options.visible, canNotify: options.canNotify })
      await barrier()
      connections++
      return reader
    } catch (error) {
      await reader.cancel()
      reader.releaseLock()
      throw error
    }
  }
  let reader: ReadableStreamDefaultReader<string>
  try {
    reader = await open()
  } catch (error) {
    controller.abort()
    throw error
  }
  async function reply(value: MonitorPresenceSend) {
    await send(value)
    await barrier()
    completedReplies.push(value)
  }
  async function consume() {
    let buffer = ''
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += chunk.value
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const { payload } = JSON.parse(line.slice(6))
            if (payload.typ === 'error') throw new Error(`${payload.code}: ${payload.msg}`)
            if (payload.typ !== 'receive') continue
            const message = payload.val as MonitorPresenceReceive
            messages.push(message)
            if (message.type === 'ping' && options.pong !== false) {
              await reply({ type: 'pong', nonce: message.nonce })
            } else if (
              (message.type === 'notify' || message.type === 'prompt') &&
              options.ack !== false
            ) {
              await reply({
                type: 'ack',
                attemptID: message.attemptID,
                shown: options.shown ?? true,
              })
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) failures.push(error)
    } finally {
      reader.releaseLock()
    }
  }
  const ended = (async () => {
    while (!controller.signal.aborted) {
      await consume()
      let backoff = 250
      while (!controller.signal.aborted) {
        try {
          await sleep(backoff, undefined, { signal: controller.signal })
          reader = await open()
          break
        } catch {
          backoff = Math.min(backoff * 2, 5_000)
        }
      }
    }
  })()
  return {
    messages,
    completedReplies,
    barrier,
    get connections() {
      return connections
    },
    failures,
    ended,
    send,
    client: {
      async request(
        procedure: 'inbox.answer',
        params: { id: string; content: Record<string, unknown> },
      ) {
        const response = await post({
          typ: 'request',
          prc: procedure,
          rid: crypto.randomUUID(),
          prm: params,
        })
        const result = await response.json()
        if (result.payload.typ === 'error') throw new Error(result.payload.msg)
        return result.payload.val as { settled: true }
      },
    },
    async close() {
      controller.abort()
      await ended
    },
  }
}
