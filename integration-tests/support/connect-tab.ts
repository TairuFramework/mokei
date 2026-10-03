import type { Monitor } from '@mokei/host-monitor'
import type { MonitorPresenceReceive, MonitorPresenceSend } from '@mokei/host-protocol'

export async function connectTab(
  monitor: Monitor,
  options: { visible: boolean; canNotify: boolean; pong?: boolean; ack?: boolean; shown?: boolean },
) {
  const controller = new AbortController()
  const rid = crypto.randomUUID()
  let sessionID: string | null = null
  const messages: Array<MonitorPresenceReceive> = []
  const failures: Array<unknown> = []
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
  const response = await post({
    typ: 'channel',
    prc: 'monitor.presence',
    rid,
    prm: { attachmentID: 'bridge-stamps-this' },
  })
  sessionID = response.headers.get('enkaku-session-id')
  if (sessionID == null || response.body == null) {
    controller.abort()
    throw new Error('Expected a presence SSE session')
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const send = async (value: MonitorPresenceSend) => {
    await post({ typ: 'send', prc: 'monitor.presence', rid, val: value })
  }
  const ended = (async () => {
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
              await send({ type: 'pong', nonce: message.nonce })
            } else if (
              (message.type === 'notify' || message.type === 'prompt') &&
              options.ack !== false
            ) {
              await send({
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
  })()
  try {
    await send({ type: 'state', visible: options.visible, canNotify: options.canNotify })
    // This short request follows channel registration and state on the same socket.
    const barrier = await post({ typ: 'request', prc: 'info', rid: crypto.randomUUID() })
    const result = await barrier.json()
    if (result.payload.typ === 'error') throw new Error(result.payload.msg)
  } catch (error) {
    controller.abort()
    await ended
    throw error
  }
  return {
    messages,
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
