import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'

import { Footer } from '../../src/chat/components/Footer.js'

describe('Footer slash suggestions', () => {
  test('shows filtered commands after typing "/"', async () => {
    const { stdin, lastFrame } = render(
      <Footer model="m" state="idle" contexts={[]} onSubmit={() => {}} />,
    )
    stdin.write('/')
    await new Promise((r) => setTimeout(r, 20))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/help')
    expect(frame).toContain('/model')
    expect(frame).toContain('/context')
  })

  test('filters down to matching prefix', async () => {
    const { stdin, lastFrame } = render(
      <Footer model="m" state="idle" contexts={[]} onSubmit={() => {}} />,
    )
    stdin.write('/c')
    await new Promise((r) => setTimeout(r, 20))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/context')
    expect(frame).not.toContain('/help')
  })
})
