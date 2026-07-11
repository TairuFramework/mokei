import { execPath } from 'node:process'
import type {
  AggregatedMessage,
  MessagePart,
  ModelProvider,
  ProviderTypes,
  StreamChatRequest,
} from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { Session } from '../src/session.js'

type FakeProviderTypes = ProviderTypes

function hangingProvider(): ModelProvider<FakeProviderTypes> {
  // Minimal provider: streamChat returns a StreamChatRequest (a Promise with
  // .abort) that resolves to an empty stream only after abort.
  const makeRequest = (): StreamChatRequest<unknown, unknown> => {
    let abortFn: () => void = () => {}
    const promise = new Promise<ReadableStream<MessagePart<unknown, unknown>>>((resolve) => {
      abortFn = () => resolve(new ReadableStream({ start: (c) => c.close() }))
    })
    ;(promise as unknown as { abort: () => void }).abort = abortFn
    // Partial mock: `Session.chat()` only ever calls `abort()` on the request, so the
    // rest of the AbortController surface (`signal`) is deliberately not implemented.
    return promise as unknown as StreamChatRequest<unknown, unknown>
  }
  return {
    streamChat: makeRequest,
    aggregateMessage: (): AggregatedMessage<unknown> => ({
      source: 'aggregated',
      role: 'assistant',
      text: '',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
    }),
    embed: async () => ({ embeddings: [] }),
    listModels: async () => [],
    toolFromMCP: (tool: unknown) => tool,
  }
}

describe('Session.chat active-request guard', () => {
  test('a third concurrent chat is rejected after one replaces another', async () => {
    const session = new Session()
    session.addProvider('fake', hangingProvider())
    const base = { provider: 'fake', model: 'm', messages: [] }

    const chatA = session.chat(base).catch(() => 'A-done')
    await new Promise((r) => setTimeout(r, 5))
    // B replaces A by aborting it.
    const chatB = session.chat({ ...base, abortActiveRequest: true }).catch(() => 'B-done')
    await new Promise((r) => setTimeout(r, 5))

    // C must see B still active and be rejected.
    await expect(session.chat(base)).rejects.toThrow('already active')

    // Cleanup: abort B.
    session.activeChatRequest?.abort()
    await Promise.all([chatA, chatB])
  })
})

describe('Session.addContext abort', () => {
  test('leaves no context behind when aborted mid-setup', async () => {
    const session = new Session()
    const controller = new AbortController()

    const promise = session
      .addContext({
        key: 'aborted',
        command: execPath,
        args: ['-e', 'setInterval(() => {}, 1e9)'],
        signal: controller.signal,
      })
      .catch(() => {})

    // Abort almost immediately, racing the spawn/registration.
    controller.abort()
    await promise

    // Give a late-registering spawn a chance to surface, then assert cleanup.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(session.contextHost.getContextKeys()).not.toContain('aborted')

    await session.contextHost.dispose()
  })
})
