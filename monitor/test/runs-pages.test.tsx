import { MantineProvider } from '@mantine/core'
import {
  type FlowControl,
  FlowControlError,
  type FlowRunSnapshot,
  type RunTrace,
} from '@mokei/flow-client'
import { createMemoryHistory, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { FlowContext, type FlowContextValue } from '../src/flow/FlowProvider.js'
import type { HostClient } from '../src/host/client.js'
import { routeTree } from '../src/routeTree.gen.js'
import { item, run, span } from './fixtures.js'

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {})
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

function fixture(path: string, snapshot: FlowRunSnapshot = run()) {
  let current = snapshot
  const log = {
    traceID: 'trace-1',
    spanID: 'child',
    timestamp: 60,
    level: 'info' as const,
    category: ['tool'],
    message: 'Selected log',
    properties: {},
  }
  const control: FlowControl & {
    runs: FlowControl['runs'] & { trace(runID: string): Promise<RunTrace> }
  } = {
    flows: { list: vi.fn(async () => []), check: vi.fn() },
    runs: {
      list: vi.fn(async (filter) =>
        [current, run('finished', 'completed')].filter(
          (entry) => filter?.states == null || filter.states.includes(entry.state),
        ),
      ),
      get: vi.fn(async () => current),
      start: vi.fn(),
      cancel: vi.fn(async () => {
        current = { ...current, state: 'cancelled' }
        return current
      }),
      trace: vi.fn(async () => ({
        spans: [span('child')],
        logs: [log, { ...log, spanID: 'other', message: 'Other span log' }],
      })),
    },
    inbox: {
      list: vi.fn(async () => [{ ...item(), plan: { tools: ['search'] } }]),
      get: vi.fn(),
      answer: vi.fn(),
      decline: vi.fn(),
      cancel: vi.fn(),
    },
    subscribe: vi.fn(),
  }
  const value: FlowContextValue = {
    control,
    client: {} as HostClient,
    epoch: 0,
    connected: true,
    restarted: false,
    status: { state: 'ready' },
    on: () => () => {},
  }
  const router = createRouter({
    routeTree: routeTree.update({ component: Outlet }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const view = (context = value) => (
    <MantineProvider>
      <FlowContext value={context}>
        <RouterProvider router={router} />
      </FlowContext>
    </MantineProvider>
  )
  return { control, value, view }
}

test('runs list filters states and cancelling an active run refreshes its state', async () => {
  const f = fixture('/runs')
  render(f.view())
  await screen.findByRole('link', { name: 'run-1' })
  expect(screen.getByRole('link', { name: 'run-1' }).getAttribute('href')).toBe('/runs/run-1')
  const finished = screen.getByRole('link', { name: 'finished' }).closest('tr')
  expect(
    within(finished as HTMLElement)
      .getByRole('button', { name: 'Cancel' })
      .hasAttribute('disabled'),
  ).toBe(true)
  fireEvent.click(screen.getByRole('radio', { name: 'completed' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'run-1' })).toBeNull())
  expect(screen.getByRole('link', { name: 'finished' })).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: 'all' }))
  const active = (await screen.findByRole('link', { name: 'run-1' })).closest('tr')
  fireEvent.click(within(active as HTMLElement).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(within(active as HTMLElement).getByText('cancelled')).toBeTruthy())
  expect(f.control.runs.cancel).toHaveBeenCalledWith('run-1')
})

test('run detail links pending items, filters logs by selected span and refreshes the trace', async () => {
  const f = fixture('/runs/run-1')
  render(f.view())
  await screen.findByRole('heading', { name: 'run-1' })
  const pending = await screen.findByRole('link', { name: 'Approval: search' })
  expect(pending.getAttribute('href')).toBe('/inbox/item-1')
  await screen.findByText('Other span log')
  fireEvent.click(screen.getByRole('button', { name: 'child' }))
  expect(screen.getByText('Selected log')).toBeTruthy()
  expect(screen.queryByText('Other span log')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Clear span selection' }))
  expect(screen.getByText('Other span log')).toBeTruthy()
  const reads = vi.mocked(f.control.runs.trace).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trace' }))
  await waitFor(() =>
    expect(vi.mocked(f.control.runs.trace).mock.calls.length).toBeGreaterThan(reads),
  )
})

test('run detail waits for the service while disconnected without offering actions', async () => {
  const f = fixture('/runs/run-1')
  const view = render(f.view())
  await screen.findByRole('heading', { name: 'run-1' })
  view.rerender(f.view({ ...f.value, connected: false }))
  expect(screen.getByText('Waiting for the flow service.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Refresh trace' })).toBeNull()
  expect(f.control.runs.cancel).not.toHaveBeenCalled()
})

test('missing run shows a not-found state', async () => {
  const f = fixture('/runs/missing')
  vi.mocked(f.control.runs.get).mockRejectedValue(
    new FlowControlError({ code: 'RUN_NOT_FOUND', message: 'Missing run' }),
  )
  render(f.view())
  expect(await screen.findByText('Run not found.')).toBeTruthy()
})

test('terminal run detail shows the result and disables cancellation', async () => {
  const f = fixture('/runs/done', {
    ...run('done', 'completed'),
    result: { outcome: 'success', output: 'Saved document', content: [] },
  })
  render(f.view())
  expect(await screen.findByRole('heading', { name: 'Result' })).toBeTruthy()
  expect(screen.getByText(/Saved document/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel run' }).hasAttribute('disabled')).toBe(true)
})
