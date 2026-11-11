import type { ElicitResult } from '@mokei/context-protocol'
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
    const { host } = setup({ elicit: false })
    const elicit = vi.fn<HostElicitOverride>(() => accept('a'))
    await host
      .callTool({ key: KEY, name: 'ask', arguments: { who: 'a' }, elicit })
      .catch(() => undefined)
    expect(elicit).not.toHaveBeenCalled()
  })
})
