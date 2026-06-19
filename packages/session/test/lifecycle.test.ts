import type { ModelProvider } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { Session } from '../src/session.js'

function hangingProvider(): ModelProvider {
  // Minimal provider: streamChat returns a StreamChatRequest (a Promise with
  // .abort) that resolves to an empty stream only after abort.
  const makeRequest = () => {
    let abortFn: () => void = () => {}
    const promise = new Promise((resolve) => {
      abortFn = () => resolve(new ReadableStream({ start: (c) => c.close() }))
    }) as ReturnType<ModelProvider['streamChat']>
    ;(promise as unknown as { abort: () => void }).abort = abortFn
    return promise
  }
  return {
    streamChat: makeRequest,
    aggregateMessage: () => ({ role: 'assistant', text: '', toolCalls: [] }),
    toolFromMCP: (t: unknown) => t,
  } as unknown as ModelProvider
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
        command: process.execPath,
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
