import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ElicitResult, ServerMessage } from '@mokei/context-protocol'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  ContextServer,
  createTaskManager,
  createTool,
  inputRequired,
} from '../../context-server/lib/index.js'
import { ContextClient, type ElicitHandler } from '../src/index.js'

type Version = '2025-11-25' | '2026-07-28'

const schema = { type: 'object' as const, properties: {} }
const disposables: Array<{ dispose: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()))
})

function setup(params: {
  version?: Version
  clientElicit?: ElicitHandler | null
  rounds?: number
}) {
  const version = params.version ?? '2026-07-28'
  const rounds = params.rounds ?? 1
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  const manager = createTaskManager({ pollIntervalMs: 60_000 })
  const server = new ContextServer({
    name: 'per-call-elicit-test',
    version: '1.0.0',
    protocolVersions: [version],
    transport: pair.server,
    subscriptions: true,
    tasks: manager,
    tools: {
      ask: createTool({
        description: 'Elicit once per round, keyed by the who argument',
        inputSchema: { type: 'object', properties: { who: { type: 'string' } } },
        handler: async ({ input, client, inputResponses, requestState }) => {
          const message = String(input.who)
          if (version === '2025-11-25') {
            const answers: Array<ElicitResult> = []
            for (let round = 0; round < rounds; round++) {
              answers.push(await client.elicit({ message, requestedSchema: schema }))
            }
            return { content: [{ type: 'text', text: JSON.stringify(answers) }] }
          }
          const answers = (
            typeof requestState === 'string' ? JSON.parse(requestState) : []
          ) as Array<unknown>
          if (inputResponses?.ask != null) answers.push(inputResponses.ask)
          if (answers.length < rounds) {
            return inputRequired({
              inputRequests: {
                ask: { method: 'elicitation/create', params: { message, requestedSchema: schema } },
              },
              requestState: JSON.stringify(answers),
            })
          }
          return { content: [{ type: 'text', text: JSON.stringify(answers) }] }
        },
      }),
      taskAsk: createTool({
        description: 'Elicit through task input',
        inputSchema: { type: 'object', properties: { who: { type: 'string' } } },
        handler: ({ input, task }) => {
          if (task == null) throw new Error('Expected task context')
          return task.run(async (handle) => {
            const responses = await handle.requestInput(
              {
                ask: {
                  method: 'elicitation/create',
                  params: { message: String(input.who), requestedSchema: schema },
                },
              },
              { signal: handle.signal },
            )
            return { content: [{ type: 'text', text: JSON.stringify(responses.ask) }] }
          })
        },
      }),
    },
    prompts: {
      greet: {
        description: 'Elicit then answer',
        handler: ({ inputResponses }) => {
          if (inputResponses?.ask == null) {
            return inputRequired({
              inputRequests: {
                ask: {
                  method: 'elicitation/create',
                  params: { message: 'prompt', requestedSchema: schema },
                },
              },
            })
          }
          return {
            messages: [
              { role: 'user', content: { type: 'text', text: JSON.stringify(inputResponses.ask) } },
            ],
          }
        },
      },
    },
  })
  const clientElicit =
    params.clientElicit === null
      ? undefined
      : (params.clientElicit ?? vi.fn<ElicitHandler>(() => ({ action: 'decline' })))
  const client = new ContextClient({
    protocolVersion: version,
    transport: pair.client,
    elicit: clientElicit,
  })
  disposables.push(client, server)
  return { client, clientElicit }
}

const accept = (by: string): ElicitResult => ({ action: 'accept', content: { by } })

function textOf(result: { content: Array<unknown> }): string {
  return (result.content[0] as { text: string }).text
}

describe('per-request elicit', () => {
  test('per-request elicit answers that call', async () => {
    const { client, clientElicit } = setup({})
    const elicit = vi.fn<ElicitHandler>(() => accept('a'))
    const result = await client.callTool({ name: 'ask', arguments: { who: 'a' }, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    expect(elicit.mock.calls[0]?.[0].params.message).toBe('a')
    expect(clientElicit).not.toHaveBeenCalled()
    expect(textOf(result)).toBe(JSON.stringify([accept('a')]))
  })

  test('keeps the handler across rounds', async () => {
    const { client, clientElicit } = setup({ rounds: 2 })
    const elicit = vi.fn<ElicitHandler>(() => accept('a'))
    await client.callTool({ name: 'ask', arguments: { who: 'a' }, elicit })
    expect(elicit).toHaveBeenCalledTimes(2)
    expect(clientElicit).not.toHaveBeenCalled()
  })

  test('abort reaches the pending handler', async () => {
    const { client } = setup({})
    const controller = new AbortController()
    const received = Promise.withResolvers<AbortSignal>()
    const elicit: ElicitHandler = ({ signal }) => {
      received.resolve(signal)
      return new Promise<ElicitResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const call = client.callTool({
      name: 'ask',
      arguments: { who: 'a' },
      elicit,
      signal: controller.signal,
    })
    const signal = await received.promise
    controller.abort(new Error('stop'))
    await expect(call).rejects.toThrow()
    expect(signal.aborted).toBe(true)
  })

  test('ignored without a client-wide handler', async () => {
    const { client } = setup({ clientElicit: null })
    const elicit = vi.fn<ElicitHandler>(() => accept('a'))
    await client.callTool({ name: 'ask', arguments: { who: 'a' }, elicit }).catch(() => undefined)
    expect(elicit).not.toHaveBeenCalled()
  })

  test('2025-11-25 ignores the per-request handler', async () => {
    const clientElicit = vi.fn<ElicitHandler>(() => accept('wide'))
    const { client } = setup({ version: '2025-11-25', clientElicit })
    const elicit = vi.fn<ElicitHandler>(() => accept('a'))
    const result = await client.callTool({ name: 'ask', arguments: { who: 'a' }, elicit })
    expect(elicit).not.toHaveBeenCalled()
    expect(clientElicit).toHaveBeenCalledTimes(1)
    expect(textOf(result)).toBe(JSON.stringify([accept('wide')]))
  })

  test('waitForTask routes task input', async () => {
    const { client, clientElicit } = setup({})
    const elicit = vi.fn<ElicitHandler>(() => accept('t'))
    const result = await client.callTool({ name: 'taskAsk', arguments: { who: 't' }, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    expect(elicit.mock.calls[0]?.[0].params.message).toBe('t')
    expect(clientElicit).not.toHaveBeenCalled()
    expect(textOf(result)).toBe(JSON.stringify(accept('t')))
  })

  test('getPrompt routes its elicitation', async () => {
    const { client, clientElicit } = setup({})
    const elicit = vi.fn<ElicitHandler>(() => accept('p'))
    const result = await client.getPrompt({ name: 'greet', arguments: {}, elicit })
    expect(elicit).toHaveBeenCalledTimes(1)
    expect(clientElicit).not.toHaveBeenCalled()
    expect(result.messages[0]?.content).toEqual({ type: 'text', text: JSON.stringify(accept('p')) })
  })
})
