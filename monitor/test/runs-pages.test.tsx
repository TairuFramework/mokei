import { MantineProvider } from '@mantine/core'
import { createMemoryHistory, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { routeTree } from '../src/routeTree.gen.js'
import { run } from './fixtures.js'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../src/flow/useRun.js', () => ({ useRun: mocks.run }))
vi.mock('../src/traces/useTraceList.js', () => ({
  useTraceList: () => ({ traces: [], loading: false, loadMore: vi.fn() }),
}))
vi.mock('../src/traces/useTrace.js', () => ({
  useTrace: () => ({ loading: false, notFound: true }),
}))

afterEach(() => vi.unstubAllGlobals())

test.each([
  ['/', undefined, '/traces', {}],
  ['/runs', undefined, '/traces', { kind: 'flow' }],
  ['/runs/run-1', 'trace-1', '/traces/trace-1', {}],
  ['/runs/run-1', undefined, '/traces', { kind: 'flow' }],
])('%s redirects to the expected trace destination', async (path, traceID, destination, search) => {
  mocks.run.mockReturnValue({ run: { ...run(), traceID }, loading: false })
  vi.stubGlobal('scrollTo', () => {})
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const router = createRouter({
    routeTree: routeTree.update({ component: Outlet }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>,
  )
  await waitFor(() => expect(router.state.location.pathname).toBe(destination))
  expect(router.state.location.search).toEqual(search)
})
