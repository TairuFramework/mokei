import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'
import { SystemNotice } from '../../src/chat/components/SystemNotice.js'
import { ToolResultCard } from '../../src/chat/components/ToolResultCard.js'
import { UserMessage } from '../../src/chat/components/UserMessage.js'

describe('components', () => {
  test('UserMessage shows the prompt text with a marker', () => {
    const { lastFrame } = render(<UserMessage text="hello" />)
    expect(lastFrame()).toContain('hello')
    expect(lastFrame()).toMatch(/you|›/i)
  })

  test('AssistantMessage shows the reply text', () => {
    const { lastFrame } = render(<AssistantMessage text="hi there" />)
    expect(lastFrame()).toContain('hi there')
  })

  test('ToolResultCard shows the tool name and result text', () => {
    const { lastFrame } = render(<ToolResultCard name="ctx:read" result="file contents" />)
    expect(lastFrame()).toContain('ctx:read')
    expect(lastFrame()).toContain('file contents')
  })

  test('ToolResultCard shows the error when error is present', () => {
    const { lastFrame } = render(<ToolResultCard name="ctx:read" error="ENOENT" />)
    expect(lastFrame()).toContain('ENOENT')
  })

  test('SystemNotice renders a warning variant', () => {
    const { lastFrame } = render(<SystemNotice variant="warning" text="stopped" />)
    expect(lastFrame()).toContain('stopped')
  })
})
