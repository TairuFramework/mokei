import { render } from 'ink-testing-library'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ProviderSelectCard } from '../../src/chat/components/ProviderSelectCard.js'

describe('ProviderSelectCard', () => {
  test('renders three provider options', () => {
    const { lastFrame } = render(<ProviderSelectCard onSelect={() => {}} onCancel={() => {}} />)
    const frame = lastFrame()!
    expect(frame).toContain('ollama')
    expect(frame).toContain('openai')
    expect(frame).toContain('anthropic')
    expect(frame).toContain('select a provider')
  })

  test('selecting a provider calls onSelect', () => {
    const onSelect = vi.fn()
    const { stdin } = render(<ProviderSelectCard onSelect={onSelect} onCancel={() => {}} />)
    // Press enter to select the first item (ollama); act() flushes the
    // useEffect in @inkjs/ui Select that calls onChange after state update.
    act(() => {
      stdin.write('\r')
    })
    expect(onSelect).toHaveBeenCalledWith('ollama')
  })

  describe('esc calls onCancel', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    test('esc calls onCancel', () => {
      const onCancel = vi.fn()
      const { stdin } = render(<ProviderSelectCard onSelect={() => {}} onCancel={onCancel} />)
      // Ink buffers a bare ESC for ~20 ms waiting for a longer escape sequence;
      // advance fake timers to flush it as a standalone escape key event.
      stdin.write('\x1b')
      vi.runAllTimers()
      expect(onCancel).toHaveBeenCalledOnce()
    })
  })
})
