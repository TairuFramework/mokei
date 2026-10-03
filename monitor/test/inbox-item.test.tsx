import { MantineProvider } from '@mantine/core'
import {
  type FlowControl,
  FlowControlError,
  type FlowEvent,
  type InboxItem,
} from '@mokei/flow-client'
import { createMemoryHistory, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { FlowContext, type FlowContextValue } from '../src/flow/FlowProvider.js'
import type { HostClient } from '../src/host/client.js'
import { routeTree } from '../src/routeTree.gen.js'
import { deferred } from './fixtures.js'

const setActiveItem = vi.fn()
vi.mock('../src/presence/PresenceProvider.js', () => ({ usePresence: () => ({ setActiveItem }) }))
beforeEach(() => {
  setActiveItem.mockClear()
  vi.stubGlobal('scrollTo', () => {})
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
})
afterEach(() => vi.unstubAllGlobals())
function fixture(
  entry: InboxItem = {
    id: 'item-1',
    runID: 'run-1',
    kind: 'approval',
    createdAt: 1,
    plan: { tools: ['search'] },
  },
  path = '/inbox/item-1',
) {
  const listeners = new Set<(event: FlowEvent) => void>()
  const control: FlowControl = {
    flows: { list: vi.fn(), check: vi.fn() },
    runs: { list: vi.fn(), get: vi.fn(), start: vi.fn(), cancel: vi.fn() },
    inbox: {
      list: vi.fn(async () => [entry]),
      get: vi.fn(async () => entry),
      answer: vi.fn(async () => {}),
      decline: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
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
    on: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const router = createRouter({
    routeTree: routeTree.update({ component: Outlet }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return {
    control,
    entry,
    emit: (event: FlowEvent) => {
      act(() => {
        for (const listener of listeners) listener(event)
      })
    },
    view: (context = value) => (
      <MantineProvider>
        <FlowContext value={context}>
          <RouterProvider router={router} />
        </FlowContext>
      </MantineProvider>
    ),
    value,
  }
}

test('observes settlement while open and reports presence on mount and unmount', async () => {
  const f = fixture()
  const view = render(f.view())
  await screen.findByRole('button', { name: 'Approve' })
  expect(screen.getByText('search')).toBeTruthy()
  expect(setActiveItem).toHaveBeenCalledWith('item-1')
  f.emit({ type: 'inbox:settled', data: { item: f.entry, outcome: 'declined' } })
  expect(await screen.findByText(/Outcome: declined/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(setActiveItem).toHaveBeenLastCalledWith(undefined)
  view.unmount()
  expect(setActiveItem).toHaveBeenLastCalledWith(undefined)
})

test('not-found on load shows No longer pending', async () => {
  const f = fixture()
  vi.mocked(f.control.inbox.get).mockRejectedValue(
    new FlowControlError({ code: 'INBOX_ITEM_NOT_FOUND', message: 'Missing' }),
  )
  render(f.view())
  expect(await screen.findByText('No longer pending')).toBeTruthy()
  expect(setActiveItem).not.toHaveBeenCalledWith('item-1')
})

test.each(['Approve', 'Deny'])(
  'approval action %s uses the matching control method',
  async (action) => {
    const f = fixture()
    render(f.view())
    fireEvent.click(await screen.findByRole('button', { name: action }))
    await waitFor(() =>
      expect(
        action === 'Approve' ? f.control.inbox.answer : f.control.inbox.decline,
      ).toHaveBeenCalledWith('item-1'),
    )
    await screen.findByText(/already settled/)
    expect(setActiveItem).toHaveBeenLastCalledWith(undefined)
  },
)

test('a submit race shows an already settled notice', async () => {
  const f = fixture()
  vi.mocked(f.control.inbox.answer).mockRejectedValue(
    new FlowControlError({ code: 'INBOX_ITEM_NOT_FOUND', message: 'Missing' }),
  )
  render(f.view())
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
  expect(await screen.findByText(/already settled/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(setActiveItem).toHaveBeenLastCalledWith(undefined)
})

test.each(['Accept', 'Decline', 'Cancel'])(
  'input action %s submits typed content or settles without content',
  async (action) => {
    const f = fixture({
      id: 'item-1',
      runID: 'run-1',
      kind: 'input',
      inputKey: 'details',
      createdAt: 1,
      message: 'Enter details',
      requestedSchema: { type: 'object', properties: { count: { type: 'integer', default: 3 } } },
    })
    render(f.view())
    fireEvent.click(await screen.findByRole('button', { name: action }))
    await waitFor(() => {
      if (action === 'Accept')
        expect(f.control.inbox.answer).toHaveBeenCalledWith('item-1', { count: 3 })
      else
        expect(
          action === 'Decline' ? f.control.inbox.decline : f.control.inbox.cancel,
        ).toHaveBeenCalledWith('item-1')
    })
  },
)

test('pending list links its items', async () => {
  const f = fixture(undefined, '/inbox')
  render(f.view())
  expect((await screen.findByRole('link', { name: 'search' })).getAttribute('href')).toBe(
    '/inbox/item-1',
  )
})

test('actions disappear when disconnected', async () => {
  const f = fixture()
  const view = render(f.view())
  await screen.findByRole('button', { name: 'Approve' })
  view.rerender(f.view({ ...f.value, connected: false }))
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(setActiveItem).toHaveBeenLastCalledWith(undefined)
})

test('daemon validation errors keep typed values and allow a corrected retry', async () => {
  const f = fixture({
    id: 'item-1',
    runID: 'run-1',
    kind: 'input',
    inputKey: 'details',
    createdAt: 1,
    message: 'Enter details',
    requestedSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  })
  vi.mocked(f.control.inbox.answer).mockRejectedValueOnce(
    new FlowControlError({
      code: 'INBOX_ANSWER_INVALID',
      message: 'Invalid',
      data: { issues: ['Name is too short'] },
    }),
  )
  render(f.view())
  await screen.findByRole('button', { name: 'Accept' })
  fireEvent.change(screen.getByLabelText(/name/), { target: { value: 'A' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(await screen.findByText('Name is too short')).toBeTruthy()
  expect((screen.getByLabelText(/name/) as HTMLInputElement).value).toBe('A')
  fireEvent.change(screen.getByLabelText(/name/), { target: { value: 'Ada' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  await waitFor(() =>
    expect(f.control.inbox.answer).toHaveBeenLastCalledWith('item-1', { name: 'Ada' }),
  )
})

test('pending actions disable both approval buttons', async () => {
  const f = fixture()
  const pending = deferred<void>()
  vi.mocked(f.control.inbox.answer).mockReturnValue(pending.promise)
  render(f.view())
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
  expect(
    (screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).matches(':disabled'),
  ).toBe(true)
  await act(async () => pending.resolve())
})

test('pending list sorts newest first and removes settled items', async () => {
  const f = fixture(undefined, '/inbox')
  const newer: InboxItem = {
    id: 'item-2',
    runID: 'run-1',
    kind: 'approval',
    createdAt: 2,
    plan: { tools: ['save'] },
  }
  vi.mocked(f.control.inbox.list).mockResolvedValue([f.entry, newer])
  render(f.view())
  await screen.findByRole('link', { name: 'save' })
  expect(
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(['approvalrun-1save', 'approvalrun-1search'])
  f.emit({ type: 'inbox:settled', data: { item: newer, outcome: 'answered' } })
  expect(screen.queryByRole('link', { name: 'save' })).toBeNull()
})
