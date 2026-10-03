import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { LogList } from '../src/components/LogList.js'
import { TraceWaterfall } from '../src/components/TraceWaterfall.js'
import { run, span } from './fixtures.js'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

test('log filters combine selected span, level and message text', () => {
  const logs = [
    {
      traceID: 'trace-1',
      spanID: 'child',
      timestamp: 60,
      level: 'info' as const,
      category: ['tool'],
      message: 'Found document',
      properties: {},
    },
    {
      traceID: 'trace-1',
      spanID: 'child',
      timestamp: 61,
      level: 'error' as const,
      category: ['tool'],
      message: 'Failed lookup',
      properties: {},
    },
    {
      traceID: 'trace-1',
      spanID: 'other',
      timestamp: 62,
      level: 'info' as const,
      category: ['tool'],
      message: 'Other document',
      properties: {},
    },
  ]
  render(
    <MantineProvider>
      <LogList logs={logs} spanID="child" />
    </MantineProvider>,
  )
  expect(screen.getByText('Found document')).toBeTruthy()
  expect(screen.queryByText('Other document')).toBeNull()
  fireEvent.change(screen.getByLabelText('Log level'), { target: { value: 'error' } })
  expect(screen.queryByText('Found document')).toBeNull()
  expect(screen.getByText('Failed lookup')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Search logs'), { target: { value: 'missing' } })
  expect(screen.queryByText('Failed lookup')).toBeNull()
  expect(screen.getByText('No matching logs.')).toBeTruthy()
})
afterEach(() => vi.unstubAllGlobals())

test('renders nested span names and selecting a span filters logs and shows its detail', () => {
  const onSelectSpan = vi.fn()
  render(
    <MantineProvider>
      <TraceWaterfall
        run={run()}
        spans={[span('parent'), span('child', 'parent')]}
        onSelectSpan={onSelectSpan}
      />
    </MantineProvider>,
  )
  expect(screen.getByText('parent')).toBeTruthy()
  fireEvent.click(screen.getByText('child'))
  expect(onSelectSpan).toHaveBeenLastCalledWith('child')
  expect(screen.getByText('tool')).toBeTruthy()
  expect(screen.getByText('"search"')).toBeTruthy()
  expect(screen.getByText('found')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear span selection' }))
  expect(onSelectSpan).toHaveBeenLastCalledWith(undefined)
})
