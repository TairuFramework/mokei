import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'
import { AssistantStreamingText } from '../../src/chat/components/AssistantStreamingText.js'
import { SystemNotice } from '../../src/chat/components/SystemNotice.js'
import { ToolApprovalCard } from '../../src/chat/components/ToolApprovalCard.js'
import { ToolCallStatus } from '../../src/chat/components/ToolCallStatus.js'
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

describe('streaming + approval', () => {
  test('AssistantStreamingText shows the current delta', () => {
    const { lastFrame } = render(<AssistantStreamingText text="partial" />)
    expect(lastFrame()).toContain('partial')
  })

  test('ToolApprovalCard shows the tool name and arguments', () => {
    const { lastFrame } = render(
      <ToolApprovalCard
        call={{ id: '1', name: 'ctx:write', arguments: '{"path":"/x"}' }}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    )
    expect(lastFrame()).toContain('ctx:write')
    expect(lastFrame()).toContain('/x')
  })

  test('ToolCallStatus shows the tool name and phase label', () => {
    const { lastFrame } = render(<ToolCallStatus name="ctx:read" phase="calling" />)
    expect(lastFrame()).toContain('ctx:read')
    expect(lastFrame()).toMatch(/calling/i)
  })
})
