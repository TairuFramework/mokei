import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'
import { AssistantStreamingText } from '../../src/chat/components/AssistantStreamingText.js'
import { Footer } from '../../src/chat/components/Footer.js'
import { HelpCard } from '../../src/chat/components/HelpCard.js'
import { ModelSelectCard } from '../../src/chat/components/ModelSelectCard.js'
import { StatusLine } from '../../src/chat/components/StatusLine.js'
import { SystemNotice } from '../../src/chat/components/SystemNotice.js'
import { ToolApprovalCard } from '../../src/chat/components/ToolApprovalCard.js'
import { ToolCallStatus } from '../../src/chat/components/ToolCallStatus.js'
import { ToolResultCard } from '../../src/chat/components/ToolResultCard.js'
import { ToolSelectCard } from '../../src/chat/components/ToolSelectCard.js'
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

describe('footer + selects + help', () => {
  test('StatusLine shows model and streaming state', () => {
    const { lastFrame } = render(
      <StatusLine model="claude-3" state="streaming" contexts={['sqlite']} />,
    )
    expect(lastFrame()).toContain('claude-3')
    expect(lastFrame()).toContain('sqlite')
  })

  test('Footer embeds StatusLine and the input prompt', () => {
    const { lastFrame } = render(
      <Footer model="claude-3" state="idle" contexts={[]} onSubmit={() => {}} />,
    )
    expect(lastFrame()).toContain('claude-3')
    expect(lastFrame()).toContain('›')
  })

  test('ModelSelectCard renders each model id', () => {
    const { lastFrame } = render(
      <ModelSelectCard
        models={[{ id: 'a' }, { id: 'b' }]}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
  })

  test('ToolSelectCard renders each tool option', () => {
    const { lastFrame } = render(
      <ToolSelectCard
        groups={[
          {
            contextKey: 'ctx',
            tools: [{ id: 'ctx:x', name: 'x', description: 'd', enabled: true }],
          },
        ]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(lastFrame()).toContain('ctx:x')
  })

  test('HelpCard lists known commands', () => {
    const { lastFrame } = render(<HelpCard />)
    expect(lastFrame()).toContain('/help')
    expect(lastFrame()).toContain('/context')
    expect(lastFrame()).toContain('/model')
    expect(lastFrame()).toContain('/tools')
    expect(lastFrame()).toContain('/quit')
  })
})
