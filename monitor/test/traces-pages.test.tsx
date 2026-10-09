import { MantineProvider } from '@mantine/core'
import type { TraceSummary } from '@mokei/host-protocol'
import { createMemoryHistory, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { routeTree } from '../src/routeTree.gen.js'
import { run, span } from './fixtures.js'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  trace: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('../src/traces/useTraceList.js', () => ({ useTraceList: mocks.list }))
vi.mock('../src/traces/useTrace.js', () => ({ useTrace: mocks.trace }))
vi.mock('../src/flow/useRun.js', () => ({ useRun: () => ({ run: run(), refresh: mocks.refresh }) }))
vi.mock('../src/flow/useInbox.js', () => ({ useInbox: () => ({ items: [{ id: 'pending' }] }) }))
vi.mock('../src/flow/FlowProvider.js', () => ({
  useFlow: () => ({
    connected: true,
    status: { state: 'ready' },
    control: { runs: { cancel: mocks.cancel } },
  }),
}))

const summary: TraceSummary = {
  traceID: 'trace-1',
  rootSpanID: 'child',
  name: 'Flow trace',
  kind: 'flow',
  startTime: 50,
  endTime: 75,
  active: false,
  outcome: 'ok',
  spanCount: 1,
  errorCount: 0,
  droppedCount: 0,
  revision: 1,
  attributes: { 'run.id': 'run-1', 'flow.id': 'flow-1' },
}

function renderPage(path: string) {
  const router = createRouter({
    routeTree: routeTree.update({ component: Outlet }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>,
  )
  return router
}

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('scrollTo', () => {})
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  mocks.list.mockReturnValue({
    traces: [
      summary,
      {
        ...summary,
        traceID: 'active',
        name: 'Active trace',
        attributes: { label: 'Active trace' },
        active: true,
        droppedCount: 2,
      },
    ],
    loading: false,
    hasMore: true,
    loadMore: vi.fn(),
    retry: mocks.retry,
  })
  mocks.trace.mockReturnValue({
    state: {
      summary,
      spans: new Map([
        [
          'child',
          {
            ...span('child'),
            attributes: {
              'mokei.mcp.request': '{"query":"hello"}',
              'mokei.payload.truncated': true,
            },
            events: [
              { name: 'mcp.response', time: 70, attributes: { payload: '{"result":"world"}' } },
            ],
          },
        ],
      ]),
      logs: new Map(),
      logsTruncated: true,
    },
    loading: false,
    retry: mocks.retry,
  })
})

test('trace list pins active traces and applies URL filters', async () => {
  renderPage('/traces?kind=flow&active=true&name=search&since=10&until=100&outcome=error')
  await screen.findByRole('heading', { name: 'Traces' })
  expect(mocks.list).toHaveBeenCalledWith({
    kind: 'flow',
    active: true,
    name: 'search',
    since: 10,
    until: 100,
    outcome: 'error',
  })
  const links = screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('/traces/'))
  expect(links.map((link) => link.textContent)).toEqual(['Active trace', 'flow-1'])
  expect(screen.getByText(/Dropped: 2/)).toBeTruthy()
})

test('span selection updates the URL and exposes request, response and truncation banners', async () => {
  const router = renderPage('/traces/trace-1')
  fireEvent.click(await screen.findByRole('button', { name: 'child' }))
  await waitFor(() => expect(router.state.location.search).toMatchObject({ span: 'child' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Request' }))
  expect(within(screen.getByRole('tabpanel', { name: 'Request' })).getByRole('tree')).toBeTruthy()
  expect(within(screen.getByRole('tabpanel', { name: 'Request' })).getByText(/hello/)).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Response' }))
  expect(within(screen.getByRole('tabpanel', { name: 'Response' })).getByRole('tree')).toBeTruthy()
  expect(within(screen.getByRole('tabpanel', { name: 'Response' })).getByText(/world/)).toBeTruthy()
  expect(screen.getByText(/Payload truncated/)).toBeTruthy()
  expect(screen.getByText(/Logs truncated/)).toBeTruthy()
})

test('flow header shows state, identifiers, pending inbox link and Cancel', async () => {
  renderPage('/traces/trace-1')
  expect(await screen.findByText('working')).toBeTruthy()
  expect(screen.getAllByText('flow-1').length).toBeGreaterThanOrEqual(1)
  expect(screen.getByRole('link', { name: /pending/i }).getAttribute('href')).toBe('/inbox/pending')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('run-1'))
})

test('context header shows command and transport', async () => {
  const result = mocks.trace()
  mocks.trace.mockReturnValue({
    ...result,
    state: {
      ...result.state,
      summary: { ...summary, kind: 'context' },
      spans: new Map([
        [
          'child',
          {
            ...span('child'),
            attributes: { 'process.command': 'server-command', 'mcp.transport': 'stdio' },
          },
        ],
      ]),
    },
  })
  renderPage('/traces/trace-1')
  expect(await screen.findByText('server-command')).toBeTruthy()
  expect(screen.getByText('stdio')).toBeTruthy()
})

test.each(['list', 'trace'] as const)('%s errors offer Retry', async (hook) => {
  mocks[hook].mockReturnValue({ ...mocks[hook](), error: new Error('Read failed') })
  renderPage('/traces/trace-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(mocks.retry).toHaveBeenCalled()
})

test('changing filters keeps the selected trace and span in the URL', async () => {
  const router = renderPage('/traces/trace-1?kind=flow&span=child')
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'search' } })
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      kind: 'flow',
      span: 'child',
      name: 'search',
    }),
  )
  expect(router.state.location.pathname).toBe('/traces/trace-1')
})

test('deep-linked span selection can be cleared without losing filters', async () => {
  const router = renderPage('/traces/trace-1?kind=flow&span=child')
  expect(await screen.findByRole('tab', { name: 'Request' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear span selection' }))
  await waitFor(() => expect(router.state.location.search.span).toBeUndefined())
  expect(router.state.location.search.kind).toBe('flow')
  expect(screen.queryByRole('tab', { name: 'Request' })).toBeNull()
})

test.each([
  ['flow', { label: 'Nightly review', 'flow.id': 'review-flow' }, 'Nightly review'],
  ['flow', { 'flow.id': 'review-flow' }, 'review-flow'],
  ['flow', {}, 'Flow trace'],
  ['context', { label: 'Server label', 'flow.id': 'ignored' }, 'Server label'],
  ['context', { 'flow.id': 'ignored' }, 'Flow trace'],
] as const)(
  'list and header share the display title for %s with %j',
  async (kind, attributes, title) => {
    const named = { ...summary, kind, attributes }
    mocks.list.mockReturnValue({ ...mocks.list(), traces: [named] })
    const trace = mocks.trace()
    mocks.trace.mockReturnValue({ ...trace, state: { ...trace.state, summary: named } })
    renderPage('/traces/trace-1')
    expect(await screen.findByRole('link', { name: title })).toBeTruthy()
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    if (title !== named.name)
      expect(screen.getAllByText(named.name).length).toBeGreaterThanOrEqual(2)
  },
)

test('Retry clears a failed Cancel alert', async () => {
  const trace = mocks.trace()
  mocks.trace.mockReturnValue({ ...trace, state: { ...trace.state, logsTruncated: false } })
  mocks.cancel.mockRejectedValueOnce(new Error('Cancel failed'))
  renderPage('/traces/trace-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByText(/Cancel failed/)).toBeTruthy()
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(mocks.refresh).toHaveBeenCalled()
})

test.each([true, false])('Load more availability follows hasMore: %s', async (hasMore) => {
  mocks.list.mockReturnValue({ ...mocks.list(), hasMore })
  renderPage('/traces')
  const button = await screen.findByRole('button', { name: 'Load more' })
  expect((button as HTMLButtonElement).disabled).toBe(!hasMore)
})
