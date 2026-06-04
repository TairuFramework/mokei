import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'
import { AssistantStreamingText } from '../../src/chat/components/AssistantStreamingText.js'
import { Footer } from '../../src/chat/components/Footer.js'
import { HelpCard } from '../../src/chat/components/HelpCard.js'
import { ModelSelectCard } from '../../src/chat/components/ModelSelectCard.js'
import { ReasoningView } from '../../src/chat/components/ReasoningView.js'
import { StatusLine } from '../../src/chat/components/StatusLine.js'
import { SystemNotice } from '../../src/chat/components/SystemNotice.js'
import { ToolApprovalCard } from '../../src/chat/components/ToolApprovalCard.js'
import { ToolCallStatus } from '../../src/chat/components/ToolCallStatus.js'
import { ToolResultCard } from '../../src/chat/components/ToolResultCard.js'
import { ToolSelectCard } from '../../src/chat/components/ToolSelectCard.js'
import { UserMessage } from '../../src/chat/components/UserMessage.js'
import { WaitingStatus } from '../../src/chat/components/WaitingStatus.js'

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

describe('ToolCallStatus elapsed + hang', () => {
  test('shows elapsed seconds while calling', () => {
    const { lastFrame } = render(
      <ToolCallStatus name="ctx:read" phase="calling" elapsedMs={3000} />,
    )
    expect(lastFrame()).toContain('ctx:read')
    expect(lastFrame()).toMatch(/3s/)
  })

  test('warns when elapsed passes the hang threshold', () => {
    const { lastFrame } = render(
      <ToolCallStatus name="ctx:read" phase="calling" elapsedMs={12000} />,
    )
    expect(lastFrame()).toMatch(/stuck/i)
  })
})

describe('ReasoningView', () => {
  test('shows the thinking label and reasoning text', () => {
    const { lastFrame } = render(<ReasoningView reasoning="weighing options" elapsedMs={2000} />)
    expect(lastFrame()).toMatch(/thinking/i)
    expect(lastFrame()).toContain('weighing options')
    expect(lastFrame()).toMatch(/2s/)
  })

  test('shows only the tail of long reasoning', () => {
    const reasoning = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const { lastFrame } = render(<ReasoningView reasoning={reasoning} />)
    expect(lastFrame()).toContain('line 19')
    expect(lastFrame()).not.toContain('line 0')
  })

  test('warns past the hang threshold', () => {
    const { lastFrame } = render(<ReasoningView reasoning="hmm" elapsedMs={12000} />)
    expect(lastFrame()).toMatch(/stuck/i)
  })
})

describe('WaitingStatus elapsed + hang', () => {
  test('shows waiting label and elapsed seconds', () => {
    const { lastFrame } = render(<WaitingStatus elapsedMs={4000} />)
    expect(lastFrame()).toMatch(/waiting for response/i)
    expect(lastFrame()).toMatch(/4s/)
  })

  test('warns when waiting passes the hang threshold', () => {
    const { lastFrame } = render(<WaitingStatus elapsedMs={15000} />)
    expect(lastFrame()).toMatch(/stuck/i)
    expect(lastFrame()).toMatch(/esc/i)
  })

  test('renders without elapsed when none provided', () => {
    const { lastFrame } = render(<WaitingStatus />)
    expect(lastFrame()).toMatch(/waiting for response/i)
  })
})

describe('ToolResultCard outcomes', () => {
  test('collapses a multi-line error to its first line with a details hint', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" error={'ENOENT: missing\nstack line 1\nstack line 2'} />,
    )
    expect(lastFrame()).toContain('ENOENT: missing')
    expect(lastFrame()).not.toContain('stack line 1')
    expect(lastFrame()).toContain('/details')
  })

  test('renders the timeout outcome', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" error="tool timed out" outcome="timeout" />,
    )
    expect(lastFrame()).toMatch(/timed out/i)
  })

  test('renders the cancelled outcome', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" error="cancelled by user" outcome="cancelled" />,
    )
    expect(lastFrame()).toMatch(/cancelled/i)
  })

  test('shows duration when provided', () => {
    const { lastFrame } = render(<ToolResultCard name="ctx:read" result="ok" durationMs={1500} />)
    expect(lastFrame()).toMatch(/1\.5s/)
  })

  test('truncates a long single-line error and shows the details hint', () => {
    const long = `E: ${'x'.repeat(400)}`
    const { lastFrame } = render(<ToolResultCard name="ctx:read" error={long} />)
    expect(lastFrame()).toContain('…')
    expect(lastFrame()).not.toContain('x'.repeat(400))
    expect(lastFrame()).toContain('/details')
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
    const { lastFrame } = render(<HelpCard onClose={() => {}} />)
    expect(lastFrame()).toContain('/help')
    expect(lastFrame()).toContain('/context')
    expect(lastFrame()).toContain('/model')
    expect(lastFrame()).toContain('/tools')
    expect(lastFrame()).toContain('/quit')
  })
})
