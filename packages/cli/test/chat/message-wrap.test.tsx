import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'

describe('assistant message wrapping', () => {
  test('wraps full width with the label inline and no gap line', () => {
    const text =
      'This is a fairly long assistant response that should wrap across multiple lines without leaving a gap below the label, and continuation lines should start at the left edge using the full width.'
    const lines = (render(<AssistantMessage text={text} />).lastFrame() ?? '').split('\n')

    // Label is inline on the first line with body text following it.
    expect(lines[0]).toMatch(/^assistant: \S/)
    // It actually wrapped to multiple lines.
    expect(lines.length).toBeGreaterThan(1)
    // Continuation starts at the left edge (full width), not indented under the
    // label, and there is no empty gap line.
    expect(lines[1]).toMatch(/^\S/)
  })
})
