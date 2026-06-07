import { render } from 'ink-testing-library'
import { describe, expect, test, vi } from 'vitest'

import { ChatApp } from '../../src/chat/ChatApp.js'

describe('ChatApp', () => {
  test('renders footer with the supplied model', () => {
    const stubSession = {
      events: { on: () => () => {} },
      addContext: vi.fn(),
      removeContext: vi.fn(),
      contextHost: {
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
})
