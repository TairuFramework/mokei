import { render } from 'ink-testing-library'
import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { ApprovalPrompt } from '../src/prompts/ApprovalPrompt.js'

describe('ApprovalPrompt', () => {
  test('lists planned tools and approves with y', () => {
    const onApprove = vi.fn()
    const onDeny = vi.fn()
    const { stdin, lastFrame } = render(
      <ApprovalPrompt tools={['fs:read', 'web:get']} onApprove={onApprove} onDeny={onDeny} />,
    )
    expect(lastFrame() ?? '').toContain('fs:read')
    expect(lastFrame() ?? '').toContain('web:get')
    act(() => {
      stdin.write('y')
    })
    expect(onApprove).toHaveBeenCalledOnce()
    expect(onDeny).not.toHaveBeenCalled()
  })

  test('n denies', () => {
    const onDeny = vi.fn()
    const { stdin } = render(<ApprovalPrompt tools={[]} onApprove={() => {}} onDeny={onDeny} />)
    act(() => {
      stdin.write('n')
    })
    expect(onDeny).toHaveBeenCalledOnce()
  })
})
