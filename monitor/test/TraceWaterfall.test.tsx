import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { TraceWaterfall } from '../src/components/TraceWaterfall.js'
import { span } from './fixtures.js'

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

afterEach(() => vi.unstubAllGlobals())

test('renders nested span names and selecting a span filters logs and shows its detail', () => {
  const onSelectSpan = vi.fn()
  render(
    <MantineProvider>
      <TraceWaterfall
        now={100}
        onOpenContext={() => {}}
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

test('expands newly polled nested spans after an empty trace while preserving user choices', () => {
  const view = (spans: Array<ReturnType<typeof span>>) => (
    <MantineProvider>
      <TraceWaterfall now={100} onOpenContext={() => {}} spans={spans} onSelectSpan={() => {}} />
    </MantineProvider>
  )
  const rendered = render(view([]))
  rendered.rerender(view([span('parent'), span('child', 'parent')]))
  expect(screen.getByRole('button', { name: 'child' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Collapse parent' }))
  rendered.rerender(
    view([
      span('parent'),
      span('child', 'parent'),
      span('new-parent'),
      span('new-child', 'new-parent'),
    ]),
  )
  expect(screen.queryByRole('button', { name: 'child' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Expand parent' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'new-child' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Expand parent' }))
  rendered.rerender(
    view([
      span('parent'),
      span('child', 'parent'),
      span('grandchild', 'child'),
      span('new-parent'),
      span('new-child', 'new-parent'),
    ]),
  )
  expect(screen.getByRole('button', { name: 'child' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'grandchild' })).toBeTruthy()
})

test('open bars grow when the supplied one second tick advances', () => {
  const { endTime, status, events, ...open } = span('open')
  const spans = [open, { ...span('later'), startTime: 1050, endTime: 1075 }]
  const view = (now: number) => (
    <MantineProvider>
      <TraceWaterfall spans={spans} now={now} onSelectSpan={() => {}} onOpenContext={() => {}} />
    </MantineProvider>
  )
  const rendered = render(view(100))
  const bar = rendered.container.querySelector('[data-open="true"]') as HTMLElement
  expect(bar).toBeTruthy()
  const width = Number.parseFloat(bar.style.width)
  rendered.rerender(view(1100))
  expect(Number.parseFloat(bar.style.width)).toBeGreaterThan(width)
  fireEvent.click(screen.getByRole('button', { name: 'open' }))
  expect(screen.getByText('unset')).toBeTruthy()
})

test('context link opens its trace without selecting the row', () => {
  const onOpenContext = vi.fn()
  const onSelectSpan = vi.fn()
  render(
    <MantineProvider>
      <TraceWaterfall
        spans={[
          {
            ...span('request'),
            attributes: { 'mokei.kind': 'mcp', 'mokei.context.trace_id': 'context-trace' },
            links: [{ traceID: 'context-trace', spanID: 'context-span' }],
          },
        ]}
        now={100}
        onSelectSpan={onSelectSpan}
        onOpenContext={onOpenContext}
      />
    </MantineProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'context ↗' }))
  expect(onOpenContext).toHaveBeenCalledWith('context-trace')
  expect(onSelectSpan).not.toHaveBeenCalled()
})

test('external span selection updates the inspector', () => {
  const view = (selectedSpanID: string) => (
    <MantineProvider>
      <TraceWaterfall
        spans={[span('first'), span('second')]}
        now={100}
        selectedSpanID={selectedSpanID}
        onSelectSpan={() => {}}
        onOpenContext={() => {}}
      />
    </MantineProvider>
  )
  const rendered = render(view('first'))
  expect(screen.getAllByText('first')).toHaveLength(3)
  rendered.rerender(view('second'))
  expect(screen.getAllByText('second')).toHaveLength(3)
})
