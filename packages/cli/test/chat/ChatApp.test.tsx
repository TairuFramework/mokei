import { render } from 'ink-testing-library'
import { describe, expect, test, vi } from 'vitest'

import { ChatApp } from '../../src/chat/ChatApp.js'

describe('ChatApp', () => {
  test('renders footer with the supplied model', () => {
    const stubSession = {
      events: { on: () => () => {} },
      addContext: vi.fn(),
      addHTTPContext: vi.fn(),
      removeContext: vi.fn(),
      contextHost: {
        events: { on: () => () => {} },
        getContextKeys: () => [],
        contexts: {},
        setContextTools: vi.fn(),
      },
      getProvider: () => ({
        listModels: async () => [{ id: 'stub-model', raw: {} }],
      }),
      dispose: async () => {},
    }
    const stubProvider = {
      listModels: async () => [{ id: 'stub-model', raw: {} }],
    }
    const { lastFrame } = render(
      <ChatApp
        session={stubSession as never}
        provider={stubProvider as never}
        providerKey="anthropic"
        initialModel="stub-model"
      />,
    )
    expect(lastFrame()).toContain('stub-model')
    expect(lastFrame()).toContain('›')
  })

  test('reconnecting, reconnected and subscription-lost show notices', async () => {
    const hostListeners = new Map<string, Array<(e: unknown) => void>>()
    const stubSession = {
      events: { on: () => () => {} },
      addContext: vi.fn(),
      addHTTPContext: vi.fn(),
      removeContext: vi.fn(),
      contextHost: {
        events: {
          on: (name: string, fn: (e: unknown) => void) => {
            hostListeners.set(name, [...(hostListeners.get(name) ?? []), fn])
            return () => {}
          },
        },
        getContextKeys: () => [],
        contexts: {},
        setContextTools: vi.fn(),
      },
      getProvider: () => ({ listModels: async () => [{ id: 'stub-model', raw: {} }] }),
      dispose: async () => {},
    }
    const { lastFrame } = render(
      <ChatApp
        session={stubSession as never}
        provider={{ listModels: async () => [{ id: 'stub-model', raw: {} }] } as never}
        providerKey="anthropic"
        initialModel="stub-model"
      />,
    )
    const emit = async (name: string, payload: unknown) => {
      for (const fn of hostListeners.get(name) ?? []) fn(payload)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await emit('context:reconnecting', { key: 'db', attempt: 2, error: new Error('x') })
    await emit('context:reconnected', { key: 'db', attempts: 2 })
    await emit('resource:subscription-lost', {
      key: 'db',
      uri: 'file:///a.txt',
      error: new Error('x'),
    })
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Reconnecting db (attempt 2)…')
    expect(frame).toContain('Reconnected db')
    expect(frame).toContain('Lost subscription file:///a.txt on db')
  })
})
