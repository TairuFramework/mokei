import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ConfirmCard } from '../../src/chat/components/ConfirmCard.js'

describe('ConfirmCard', () => {
  test("renders the message and 'y' confirms", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { lastFrame, stdin } = render(
      <ConfirmCard message="remove context fetch?" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(lastFrame()).toContain('remove context fetch?')
    stdin.write('y')
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  test("'n' cancels", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { stdin } = render(<ConfirmCard message="x?" onConfirm={onConfirm} onCancel={onCancel} />)
    stdin.write('n')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('enter confirms', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { stdin } = render(<ConfirmCard message="x?" onConfirm={onConfirm} onCancel={onCancel} />)
    stdin.write('\r')
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  describe('esc cancels', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    test('esc cancels', () => {
      const onCancel = vi.fn()
      const { stdin } = render(
        <ConfirmCard message="x?" onConfirm={() => {}} onCancel={onCancel} />,
      )
      // Ink buffers a bare ESC for ~20 ms waiting for a longer escape sequence;
      // advance fake timers to flush it as a standalone escape key event.
      stdin.write('\x1b')
      vi.runAllTimers()
      expect(onCancel).toHaveBeenCalledOnce()
    })
  })
})
