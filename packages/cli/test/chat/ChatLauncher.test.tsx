import { render } from 'ink-testing-library'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const { buildChat } = vi.hoisted(() => ({ buildChat: vi.fn() }))
vi.mock('../../src/chat/providers.js', () => ({
  buildChat,
}))

import { ChatLauncher } from '../../src/chat/ChatLauncher.js'

const noopLifecycle = () => ({ dispose: null })

afterEach(() => {
  buildChat.mockReset()
})

describe('ChatLauncher — llama path', () => {
  test('renders the path card when llama has no model and does not build yet', () => {
    const { lastFrame } = render(
      <ChatLauncher
        initialProvider="llama"
        chatOptions={{ timeoutMs: 1000 }}
        lifecycle={noopLifecycle()}
      />,
    )
    expect(lastFrame() ?? '').toContain('enter GGUF model path')
    expect(buildChat).not.toHaveBeenCalled()
  })

  test('builds llama with the entered path after submit', async () => {
    buildChat.mockResolvedValue({ element: null, dispose: async () => {} })
    const { stdin } = render(
      <ChatLauncher
        initialProvider="llama"
        chatOptions={{ timeoutMs: 1000 }}
        lifecycle={noopLifecycle()}
      />,
    )
    act(() => {
      stdin.write('/models/test.gguf')
    })
    act(() => {
      stdin.write('\r')
    })
    await vi.waitFor(() => {
      expect(buildChat).toHaveBeenCalledWith('llama', {
        timeoutMs: 1000,
        model: '/models/test.gguf',
      })
    })
  })

  test('builds llama immediately when a model path is supplied via flag', async () => {
    buildChat.mockResolvedValue({ element: null, dispose: async () => {} })
    render(
      <ChatLauncher
        initialProvider="llama"
        chatOptions={{ model: '/models/flag.gguf', timeoutMs: 1000 }}
        lifecycle={noopLifecycle()}
      />,
    )
    await vi.waitFor(() => {
      expect(buildChat).toHaveBeenCalledWith('llama', {
        model: '/models/flag.gguf',
        timeoutMs: 1000,
      })
    })
  })
})
