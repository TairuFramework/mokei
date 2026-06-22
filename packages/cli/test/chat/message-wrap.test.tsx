import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'
import { UserMessage } from '../../src/chat/components/UserMessage.js'

const LONG =
  'This is a fairly long line that should wrap across multiple lines and the continuation lines should hang-indent under the narrow icon column rather than leaving a wide empty gutter on the left.'

describe('message wrapping (two-column icon layout)', () => {
  test('assistant message: icon column then wrapped body, continuation hangs at the gutter', () => {
    const lines = (render(<AssistantMessage text={LONG} />).lastFrame() ?? '').split('\n')
    expect(lines[0]).toContain('●')
    expect(lines.length).toBeGreaterThan(1)
    // Continuation hangs under the right column (2-cell gutter), not col 0 or a
    // wide label indent, and is not an empty gap line.
    expect(lines[1]).toMatch(/^ {2}\S/)
  })

  test('user message keeps the › icon', () => {
    const lines = (render(<UserMessage text={LONG} />).lastFrame() ?? '').split('\n')
    expect(lines[0]).toContain('›')
    expect(lines[1]).toMatch(/^ {2}\S/)
  })
})
