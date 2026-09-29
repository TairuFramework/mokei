import type { ElicitRequest, ElicitResult } from '@mokei/context-protocol'
import type { HostElicitHandler } from '@mokei/host'
import type { ModelProvider, ProviderTypes } from '@mokei/model-provider'
import { defer } from '@sozai/async'
import { describe, expect, test } from 'vitest'

import { type AgentEvent, AgentSession, Session } from '../src/index.js'

const answerSchema = { type: 'object' as const, properties: {} }
const provider = {} as ModelProvider<ProviderTypes>

function createSession(elicit: true | HostElicitHandler) {
  const session = new Session({ elicit })
  const observed: Array<ElicitResult> = []
  session.contextHost.addDirectContext({
    key: 'questions',
    protocolVersion: '2025-11-25',
    config: {
      name: 'questions',
      version: '1.0.0',
      protocolVersions: ['2025-11-25'],
      tools: {
        ask: {
          description: 'Ask the client',
          inputSchema: {
            type: 'object' as const,
            properties: { message: { type: 'string' as const } },
          },
          handler: async ({
            client,
            input,
          }: {
            client: { elicit: (params: ElicitRequest['params']) => Promise<ElicitResult> }
            input: Record<string, unknown>
          }) => {
            const result = await client.elicit({
              message: String(input.message),
              requestedSchema: answerSchema,
            })
            observed.push(result)
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
          },
        },
      },
    },
  })
  const ask = (message: string) =>
    session.contextHost.callTool({ key: 'questions', name: 'ask', arguments: { message } })
  return { session, observed, ask }
}

type ElicitationEvent = Extract<AgentEvent, { type: `elicitation-${string}` }>

function elicitationEvents(events: Array<AgentEvent>): Array<ElicitationEvent> {
  return events.filter((event): event is ElicitationEvent => event.type.startsWith('elicitation-'))
}

describe('AgentSession elicitation ownership', () => {
  test('default Session agent constructs without an override', async () => {
    const session = new Session()
    const agent = new AgentSession({ session, provider, model: 'test-model' })

    expect(agent).toBeInstanceOf(AgentSession)
    await agent.dispose()
    await session.dispose()
  })

  test('onElicitation on a disabled host throws', async () => {
    const session = new Session()

    expect(
      () =>
        new AgentSession({
          session,
          provider,
          model: 'test-model',
          onElicitation: () => ({ action: 'decline' }),
        }),
    ).toThrow(/elicitation.*enabled/i)
    await session.dispose()
  })

  test('second agent on one enabled host throws', async () => {
    const session = new Session({ elicit: true })
    const first = new AgentSession({ session, provider, model: 'test-model' })

    expect(() => new AgentSession({ session, provider, model: 'test-model' })).toThrow(
      /already installed/i,
    )
    await first.dispose()
    await session.dispose()
  })

  test('agent without callback falls back to the base handler', async () => {
    const { session, observed, ask } = createSession(() => ({
      action: 'accept',
      content: { answer: 'base secret' },
    }))
    const events: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onEvent: (event) => events.push(event),
    })

    await ask('base')

    expect(observed).toEqual([{ action: 'accept', content: { answer: 'base secret' } }])
    expect(elicitationEvents(events)).toMatchObject([
      { type: 'elicitation-request', key: 'questions', params: { message: 'base' } },
      { type: 'elicitation-response', key: 'questions', action: 'accept' },
    ])
    const paired = elicitationEvents(events)
    const request = paired.find((event) => event.type === 'elicitation-request')
    const response = paired.find((event) => event.type === 'elicitation-response')
    expect(response).not.toHaveProperty('content')
    expect(response?.requestID).toBe(request?.requestID)
    await agent.dispose()
    await session.dispose()
  })

  test('agent without callback declines without a base handler', async () => {
    const { session, observed, ask } = createSession(true)
    const events: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onEvent: (event) => events.push(event),
    })

    await ask('decline')

    expect(observed).toEqual([{ action: 'decline' }])
    expect(elicitationEvents(events)).toMatchObject([
      { type: 'elicitation-request', key: 'questions' },
      { type: 'elicitation-response', key: 'questions', action: 'decline' },
    ])
    await agent.dispose()
    await session.dispose()
  })

  test('throwing onEvent on elicitation-request preserves the answer and event pair', async () => {
    const { session, observed, ask } = createSession(true)
    const emitted: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'accept', content: { answer: 'secret' } }),
      onEvent: (event) => {
        if (event.type === 'elicitation-request') throw new Error('observer failed')
      },
    })
    agent.events.on('event', (event) => {
      emitted.push(event)
    })

    await ask('request observer')

    expect(observed).toEqual([{ action: 'accept', content: { answer: 'secret' } }])
    const paired = elicitationEvents(emitted)
    expect(paired.map((event) => event.type)).toEqual([
      'elicitation-request',
      'elicitation-response',
    ])
    expect(paired[1]?.requestID).toBe(paired[0]?.requestID)
    await agent.dispose()
    await session.dispose()
  })

  test('throwing onEvent on elicitation-response preserves the answer and event pair', async () => {
    const { session, observed, ask } = createSession(true)
    const emitted: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'accept', content: { answer: 'secret' } }),
      onEvent: (event) => {
        if (event.type === 'elicitation-response') throw new Error('observer failed')
      },
    })
    agent.events.on('event', (event) => {
      emitted.push(event)
    })

    await ask('response observer')

    expect(observed).toEqual([{ action: 'accept', content: { answer: 'secret' } }])
    const paired = elicitationEvents(emitted)
    expect(paired.map((event) => event.type)).toEqual([
      'elicitation-request',
      'elicitation-response',
    ])
    expect(paired[1]?.requestID).toBe(paired[0]?.requestID)
    await agent.dispose()
    await session.dispose()
  })

  test('throwing onEvent on elicitation-request preserves the callback error', async () => {
    const { session, ask } = createSession(true)
    const emitted: Array<AgentEvent> = []
    const callbackError = new Error('callback failed')
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onElicitation: () => {
        throw callbackError
      },
      onEvent: (event) => {
        if (event.type === 'elicitation-request') throw new Error('observer failed')
      },
    })
    agent.events.on('event', (event) => {
      emitted.push(event)
    })

    const result = await ask('callback error')

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'callback failed' }],
    })
    const paired = elicitationEvents(emitted)
    expect(paired.map((event) => event.type)).toEqual(['elicitation-request', 'elicitation-error'])
    expect(paired[1]?.requestID).toBe(paired[0]?.requestID)
    expect(paired[1]).toMatchObject({ error: callbackError })
    await agent.dispose()
    await session.dispose()
  })

  test('rejecting events listener preserves the answer without an unhandled rejection', async () => {
    const { session, observed, ask } = createSession(true)
    const emitted: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'accept', content: { answer: 'secret' } }),
    })
    agent.events.on('event', async () => {
      throw new Error('listener failed')
    })
    agent.events.on('event', (event) => {
      emitted.push(event)
    })

    await ask('rejecting listener')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(observed).toEqual([{ action: 'accept', content: { answer: 'secret' } }])
    const paired = elicitationEvents(emitted)
    expect(paired.map((event) => event.type)).toEqual([
      'elicitation-request',
      'elicitation-response',
    ])
    expect(paired[1]?.requestID).toBe(paired[0]?.requestID)
    await agent.dispose()
    await session.dispose()
  })

  test('agent disposal restores the base handler', async () => {
    const { session, observed, ask } = createSession(() => ({ action: 'decline' }))
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'accept', content: { answer: 'agent' } }),
    })

    await ask('owned')
    await agent.dispose()
    await ask('base')

    expect(observed).toEqual([
      { action: 'accept', content: { answer: 'agent' } },
      { action: 'decline' },
    ])
    await session.dispose()
  })

  test('pairs concurrent elicitation requests by requestID', async () => {
    const { session, observed, ask } = createSession(true)
    const events: Array<AgentEvent> = []
    const first = defer<ElicitResult>()
    const second = defer<ElicitResult>()
    const bothStarted = defer<void>()
    let started = 0
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onEvent: (event) => events.push(event),
      onElicitation: ({ params }) => {
        started++
        if (started === 2) bothStarted.resolve()
        return params.message === 'first' ? first.promise : second.promise
      },
    })

    const firstCall = ask('first')
    const secondCall = ask('second')
    await bothStarted.promise
    second.resolve({ action: 'accept', content: { answer: 'second secret' } })
    await secondCall
    first.resolve({ action: 'cancel' })
    await firstCall

    const paired = elicitationEvents(events)
    expect(paired.map((event) => event.type)).toEqual([
      'elicitation-request',
      'elicitation-request',
      'elicitation-response',
      'elicitation-response',
    ])
    const requests = paired.filter((event) => event.type === 'elicitation-request')
    const responses = paired.filter((event) => event.type === 'elicitation-response')
    expect(requests[0]).toHaveProperty('requestID')
    expect(requests[1]).toHaveProperty('requestID')
    expect(requests[0]?.requestID).not.toBe(requests[1]?.requestID)
    expect(responses).toMatchObject([
      { requestID: requests[1]?.requestID, action: 'accept' },
      { requestID: requests[0]?.requestID, action: 'cancel' },
    ])
    expect(responses.every((event) => !('content' in event))).toBe(true)
    expect(observed).toEqual([
      { action: 'accept', content: { answer: 'second secret' } },
      { action: 'cancel' },
    ])
    await agent.dispose()
    await session.dispose()
  })

  test('agent disposal aborts a pending fallback and ignores its late answer', async () => {
    const started = defer<void>()
    const answer = defer<ElicitResult>()
    let baseSignal: AbortSignal | undefined
    const { session, ask } = createSession(({ key, signal }) => {
      expect(key).toBe('questions')
      baseSignal = signal
      started.resolve()
      return answer.promise
    })
    const events: Array<AgentEvent> = []
    const emitted: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider,
      model: 'test-model',
      onEvent: (event) => events.push(event),
    })
    agent.events.on('event', (event) => {
      emitted.push(event)
    })

    const call = ask('pending')
    await started.promise
    await agent.dispose()
    await call.catch(() => undefined)

    expect(baseSignal?.aborted).toBe(true)
    expect(elicitationEvents(events).map((event) => event.type)).toEqual([
      'elicitation-request',
      'elicitation-error',
    ])
    expect(elicitationEvents(emitted)).toEqual(elicitationEvents(events))
    answer.resolve({ action: 'accept', content: { answer: 'too late' } })
    await Promise.resolve()
    expect(elicitationEvents(events)).toHaveLength(2)
    await session.dispose()
  })
})
