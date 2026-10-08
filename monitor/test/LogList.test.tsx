import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { LogList } from '../src/components/LogList.js'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
})
afterEach(() => vi.unstubAllGlobals())

test('log filters combine selected span, level and message text', () => {
  const logs = [
    {
      logID: crypto.randomUUID(),
      traceID: 'trace-1',
      spanID: 'child',
      timestamp: 60,
      level: 'info' as const,
      category: ['tool'],
      message: 'Found document',
      properties: {},
    },
    {
      logID: crypto.randomUUID(),
      traceID: 'trace-1',
      spanID: 'child',
      timestamp: 61,
      level: 'error' as const,
      category: ['tool'],
      message: 'Failed lookup',
      properties: {},
    },
    {
      logID: crypto.randomUUID(),
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

test('LogList keys by logID and filters by spanID', () => {
  const logs = ['first', 'second'].map((logID) => ({
    logID,
    traceID: 'trace-1',
    spanID: logID,
    timestamp: 60,
    level: 'info' as const,
    category: ['tool'],
    message: logID,
    properties: {},
  }))
  const view = (entries: typeof logs, spanID?: string) => (
    <MantineProvider>
      <LogList logs={entries} spanID={spanID} />
    </MantineProvider>
  )
  const rendered = render(view(logs))
  const firstRow = screen.getByText('first').closest('tr')
  rendered.rerender(view([...logs].reverse()))
  expect(screen.getByText('first').closest('tr')).toBe(firstRow)
  rendered.rerender(view(logs, 'first'))
  expect(screen.queryByText('second')).toBeNull()
  expect(screen.getByText('first').closest('tr')).toBe(firstRow)
})
