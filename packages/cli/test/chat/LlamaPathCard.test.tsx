import { render } from 'ink-testing-library'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { LlamaPathCard } from '../../src/chat/components/LlamaPathCard.js'

describe('LlamaPathCard', () => {
  test('renders the path prompt', () => {
    const { lastFrame } = render(<LlamaPathCard onSubmit={() => {}} onCancel={() => {}} />)
    expect(lastFrame() ?? '').toContain('enter GGUF model path')
  })

  test('submitting a path calls onSubmit with the trimmed value', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<LlamaPathCard onSubmit={onSubmit} onCancel={() => {}} />)
    act(() => {
      stdin.write('/models/test.gguf')
    })
    act(() => {
      stdin.write('\r')
    })
    expect(onSubmit).toHaveBeenCalledWith('/models/test.gguf')
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
      const { stdin } = render(<LlamaPathCard onSubmit={() => {}} onCancel={onCancel} />)
      // Ink buffers a bare ESC for ~20 ms; advance fake timers to flush it.
      stdin.write('\x1b')
      vi.runAllTimers()
      expect(onCancel).toHaveBeenCalledOnce()
    })
  })
})
