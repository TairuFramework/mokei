import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ConnectionBanner } from '../src/components/ConnectionBanner.js'

const state = vi.hoisted(() => ({ status: { state: 'ready' } as Record<string, unknown> }))
vi.mock('../src/flow/FlowProvider.js', () => ({
  useFlow: () => ({ connected: true, restarted: false, status: state.status }),
}))

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
})
afterEach(() => vi.unstubAllGlobals())

test('a failed flow service shows the failing file and its issues', () => {
  state.status = {
    state: 'failed',
    error: {
      type: 'FlowDefinitionError',
      message: 'Invalid flow definition',
      path: '/flows/broken.json',
      issues: ['nodes.*: schema', 'nodes.*: schema'],
    },
  }
  render(
    <MantineProvider>
      <ConnectionBanner />
    </MantineProvider>,
  )
  expect(screen.getByText('Flow service failed')).toBeTruthy()
  expect(screen.getByText('Invalid flow definition (/flows/broken.json)')).toBeTruthy()
  expect(screen.getAllByText('nodes.*: schema')).toHaveLength(2)
})
