import type { ElicitResult } from '@mokei/context-protocol'
import { TransportClosedError } from '@mokei/context-rpc'
import { inputRequired } from '@mokei/context-server'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextHost, type HostElicitHandler, type HostElicitOverride } from '../src/index.js'

const schema = { type: 'object' as const, properties: {} }
const KEY = 'ctx'
const hosts: Array<ContextHost> = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

function elicitation(message: string) {
  return {
    inputRequests: {
      ask: {
        method: 'elicitation/create' as const,
        params: { message, requestedSchema: schema },
      },
    },
  }
}

const config = {
  name: 'per-call-elicit-test',
  version: '1.0.0',
  protocolVersions: ['2026-07-28' as const],
  tools: {
    ask: {
      description: 'Elicit once with the who argument as message',
      inputSchema: { type: 'object' as const, properties: { who: { type: 'string' as const } } },
      handler: ({
        input,
        inputResponses,
      }: {
        input: { who?: string }
        inputResponses?: Record<string, unknown>
      }) => {
        if (inputResponses?.ask == null) return inputRequired(elicitation(String(input.who)))
        return { content: [{ type: 'text' as const, text: JSON.stringify(inputResponses.ask) }] }
      },
    },
  },
  prompts: {
    greet: {
      description: 'Elicit then answer',
      handler: ({ inputResponses }: { inputResponses?: Record<string, unknown> }) => {
        if (inputResponses?.ask == null) return inputRequired(elicitation('prompt'))
        return {
          messages: [
            {
              role: 'user' as const,
              content: { type: 'text' as const, text: JSON.stringify(inputResponses.ask) },
            },
          ],
        }
      },
    },
  },
}

function setup(params: { elicit?: false } = {}) {
  const hostElicit = vi.fn<HostElicitHandler>(() => ({ action: 'decline' }))
  const host = new ContextHost({ elicit: hostElicit })
  hosts.push(host)
  host.addDirectContext({ key: KEY, config, protocolVersion: '2026-07-28', elicit: params.elicit })
  return { host, hostElicit }
}

const accept = (by: string): ElicitResult => ({ action: 'accept', content: { by } })

function textOf(result: { content: Array<unknown> }): string {
  return (result.content[0] as { text: string }).text
}

describe('ContextHost per-call elicit', () => {
  test('per-call handler answers its call', async () => {
    const { host, hostElicit } = setup()
    const elicit = vi.fn<HostElicitOverride>(() => accept('a'))
    const result = await host.callTool({ key: KEY, name: 'ask', arguments: { who: 'a' }, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    const [request] = elicit.mock.calls[0] ?? []
    expect(request?.key).toBe(KEY)
    expect(request?.params.message).toBe('a')
    expect(hostElicit).not.toHaveBeenCalled()
    expect(textOf(result)).toBe(JSON.stringify(accept('a')))
  })

  test('wins over handleElicitation', async () => {
    const { host } = setup()
    const override = vi.fn<HostElicitOverride>(() => accept('override'))
    host.handleElicitation(override)
    const elicit = vi.fn<HostElicitOverride>(() => accept('a'))
    await host.callTool({ key: KEY, name: 'ask', arguments: { who: 'a' }, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    expect(override).not.toHaveBeenCalled()
  })

  test('fallback reaches the host-wide path', async () => {
    const { host, hostElicit } = setup()
    hostElicit.mockImplementation(() => accept('host'))
    const viaHost = await host.callTool({
      key: KEY,
      name: 'ask',
      arguments: { who: 'a' },
      elicit: (_request, fallback) => fallback(),
    })
    expect(hostElicit).toHaveBeenCalledTimes(1)
    expect(textOf(viaHost)).toBe(JSON.stringify(accept('host')))

    const override = vi.fn<HostElicitOverride>(() => accept('override'))
    host.handleElicitation(override)
    const viaOverride = await host.callTool({
      key: KEY,
      name: 'ask',
      arguments: { who: 'b' },
      elicit: (_request, fallback) => fallback(),
    })
    expect(override).toHaveBeenCalledTimes(1)
    expect(textOf(viaOverride)).toBe(JSON.stringify(accept('override')))
  })

  test('fallback keeps an aborted signal', async () => {
    const { host, hostElicit } = setup()
    let seen: AbortSignal | undefined
    hostElicit.mockImplementation(({ signal }) => {
      seen = signal
      return accept('host')
    })
    await host.callTool({
      key: KEY,
      name: 'ask',
      arguments: { who: 'a' },
      elicit: (_request, fallback) => {
        const controller = new AbortController()
        controller.abort(new Error('stop'))
        return fallback({ signal: controller.signal })
      },
    })
    expect(seen?.aborted).toBe(true)
  })

  test('callNamespacedTool passes it through', async () => {
    const { host, hostElicit } = setup()
    const elicit = vi.fn<HostElicitOverride>(() => accept('b'))
    await host.callNamespacedTool({ id: `${KEY}:ask`, arguments: { who: 'b' }, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    expect(elicit.mock.calls[0]?.[0].params.message).toBe('b')
    expect(hostElicit).not.toHaveBeenCalled()
  })

  test('getPrompt passes it through', async () => {
    const { host, hostElicit } = setup()
    const elicit = vi.fn<HostElicitOverride>(() => accept('p'))
    const result = await host.getPrompt({ key: KEY, name: 'greet', arguments: {}, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    expect(hostElicit).not.toHaveBeenCalled()
    expect(result.messages[0]?.content).toEqual({ type: 'text', text: JSON.stringify(accept('p')) })
  })

  test('elicit: false context ignores it', async () => {
    const outcome = (call: Promise<unknown>) =>
      call.then(
        () => 'resolved',
        (error: unknown) => `rejected: ${(error as Error).name}`,
      )
    const baseline = setup({ elicit: false })
    const expected = await outcome(
      baseline.host.callTool({ key: KEY, name: 'ask', arguments: { who: 'a' } }),
    )

    const { host } = setup({ elicit: false })
    const elicit = vi.fn<HostElicitOverride>(() => accept('a'))
    const actual = await outcome(
      host.callTool({ key: KEY, name: 'ask', arguments: { who: 'a' }, elicit }),
    )
    expect(elicit).not.toHaveBeenCalled()
    expect(actual).toBe(expected)
  })

  test('concurrent calls each get their own elicitation', async () => {
    const { host, hostElicit } = setup()
    const bCalled = Promise.withResolvers<void>()
    const ha = vi.fn<HostElicitOverride>(async () => {
      await bCalled.promise
      return accept('a')
    })
    const hb = vi.fn<HostElicitOverride>(() => {
      bCalled.resolve()
      return accept('b')
    })
    const [a, b] = await Promise.all([
      host.callTool({ key: KEY, name: 'ask', arguments: { who: 'a' }, elicit: ha }),
      host.callTool({ key: KEY, name: 'ask', arguments: { who: 'b' }, elicit: hb }),
    ])
    expect(textOf(a)).toBe(JSON.stringify(accept('a')))
    expect(textOf(b)).toBe(JSON.stringify(accept('b')))
    expect(ha.mock.calls.map(([request]) => request.params.message)).toEqual(['a'])
    expect(hb.mock.calls.map(([request]) => request.params.message)).toEqual(['b'])
    expect(hostElicit).not.toHaveBeenCalled()
  })

  test('a throwing handler fails only its call', async () => {
    const baseline = setup()
    baseline.hostElicit.mockImplementation(() => {
      throw new Error('handler failed')
    })
    const baselineOutcome = await baseline.host
      .callTool({ key: KEY, name: 'ask', arguments: { who: 'a' } })
      .then(
        () => 'resolved',
        () => 'rejected',
      )

    const { host } = setup()
    const ha = () => {
      throw new Error('handler failed')
    }
    const [a, b] = await Promise.allSettled([
      host.callTool({ key: KEY, name: 'ask', arguments: { who: 'a' }, elicit: ha }),
      host.callTool({ key: KEY, name: 'ask', arguments: { who: 'b' }, elicit: () => accept('b') }),
    ])
    expect(a.status === 'fulfilled' ? 'resolved' : 'rejected').toBe(baselineOutcome)
    expect(b.status).toBe('fulfilled')
    if (b.status === 'fulfilled') expect(textOf(b.value)).toBe(JSON.stringify(accept('b')))
  })

  test('fallback rejects instead of throwing when the override throws', async () => {
    const { host } = setup()
    host.handleElicitation(() => {
      throw new Error('override failed')
    })
    const result = await host.callTool({
      key: KEY,
      name: 'ask',
      arguments: { who: 'a' },
      elicit: (_request, fallback) => fallback().catch(() => accept('caught')),
    })
    expect(textOf(result)).toBe(JSON.stringify(accept('caught')))
  })

  test('remove aborts a waiting handler and rejects its call', async () => {
    const { host } = setup()
    const received = Promise.withResolvers<AbortSignal>()
    const elicit: HostElicitOverride = ({ signal }) => {
      received.resolve(signal)
      return new Promise<ElicitResult>((resolve) => {
        signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true })
      })
    }
    const controller = new AbortController()
    const call = host.callTool({
      key: KEY,
      name: 'ask',
      arguments: { who: 'a' },
      signal: controller.signal,
      elicit,
    })
    const signal = await received.promise
    await host.remove(KEY)
    expect(signal.aborted).toBe(true)
    await expect(call).rejects.toBeInstanceOf(TransportClosedError)
  })
})
