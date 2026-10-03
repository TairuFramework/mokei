import { MantineProvider } from '@mantine/core'
import type { FlowSummary } from '@mokei/flow-client'
import type * as Router from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { StartRunForm } from '../src/components/StartRunForm.js'
import { FlowsPage } from '../src/routes/flows.js'

const state = vi.hoisted(() => ({
  start: vi.fn(),
  check: vi.fn(),
  navigate: vi.fn(),
  flows: [] as Array<FlowSummary & { definition?: Record<string, unknown> }>,
  connected: true,
  status: { state: 'ready' },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  useNavigate: () => state.navigate,
}))
vi.mock('../src/flow/useFlows.js', () => ({
  useFlows: () => ({ flows: state.flows, loading: false, error: undefined }),
}))
vi.mock('../src/flow/FlowProvider.js', () => ({
  useFlow: () => ({
    control: { runs: { start: state.start }, flows: { check: state.check } },
    connected: state.connected,
    status: state.status,
  }),
}))
const flow: FlowSummary = {
  id: 'greet',
  name: 'Greeting',
  version: 1,
  outputs: ['message'],
  outcomes: ['success'],
  input: {
    type: 'object',
    properties: { name: { type: 'string', title: 'Name' } },
    required: ['name'],
  },
}
const nested = { ...flow, input: { type: 'object', properties: { nested: { type: 'object' } } } }
function show(selected = flow) {
  const onStarted = vi.fn()
  render(
    <MantineProvider>
      <StartRunForm flow={selected} onStarted={onStarted} />
    </MantineProvider>,
  )
  return onStarted
}
beforeEach(() => {
  state.start.mockReset().mockResolvedValue({ runID: 'run-1' })
  state.check.mockReset()
  state.navigate.mockReset()
  state.flows = [flow]
  state.connected = true
  state.status = { state: 'ready' }
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal('visualViewport', { addEventListener() {}, removeEventListener() {} })
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

test('flat input renders fields and starts with typed input and label', async () => {
  const onStarted = show()
  expect(screen.queryByLabelText('JSON input')).toBeNull()
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Morning greeting' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-1'))
  expect(state.start).toHaveBeenCalledWith({
    flow: 'greet',
    input: { name: 'Ada' },
    label: 'Morning greeting',
  })
})
test.each(['{', '[]', 'null', '42', '"text"'])(
  'non-flat input blocks invalid object JSON: %s',
  (json) => {
    show(nested)
    fireEvent.change(screen.getByLabelText('JSON input'), { target: { value: json } })
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
    expect(state.start).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a valid JSON object')).toBeTruthy()
  },
)
test('non-flat input submits an object without a label', async () => {
  const onStarted = show(nested)
  fireEvent.change(screen.getByLabelText('JSON input'), {
    target: { value: '{"nested":{"name":"Ada"}}' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-1'))
  expect(state.start).toHaveBeenCalledWith({
    flow: 'greet',
    input: { nested: { name: 'Ada' } },
    label: undefined,
  })
})
test('daemon errors render on the form without navigating', async () => {
  state.start.mockRejectedValue(new Error('Invalid flow input'))
  const onStarted = show(nested)
  fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
  expect(await screen.findByText('Error: Invalid flow input')).toBeTruthy()
  expect(onStarted).not.toHaveBeenCalled()
})
test.each(['disconnected', 'starting'])('blocks start while %s', (reason) => {
  state.connected = reason !== 'disconnected'
  state.status = { state: reason === 'starting' ? 'starting' : 'ready' }
  show(nested)
  expect(screen.getByRole('button', { name: 'Start run' }).closest('fieldset')?.disabled).toBe(true)
  const form = screen.getByRole('button', { name: 'Start run' }).closest('form')
  if (form == null) throw new Error('Missing form')
  fireEvent.submit(form)
  expect(state.start).not.toHaveBeenCalled()
})

function showPage() {
  render(
    <MantineProvider>
      <FlowsPage />
    </MantineProvider>,
  )
}
test('flows table opens the start form and navigates to the returned run', async () => {
  showPage()
  for (const value of ['Greeting', 'greet', '1', 'message', 'success']) {
    expect(screen.getByRole('cell', { name: value })).toBeTruthy()
  }
  expect(screen.getByRole('button', { name: 'Check' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Start run' })[1])
  await waitFor(() =>
    expect(state.navigate).toHaveBeenCalledWith({ to: '/runs/$runID', params: { runID: 'run-1' } }),
  )
})
test('check submits the available definition and shows issues and warnings', async () => {
  const definition = { name: 'Greeting', version: 1, input: flow.input, steps: [] }
  state.flows = [{ ...flow, definition }]
  state.check.mockResolvedValue({
    issues: [
      {
        path: ['steps', 0],
        severity: 'error',
        code: 'MISSING_TOOL',
        message: 'Tool unavailable',
        hint: 'Connect the tool server',
      },
    ],
    warnings: [
      { path: ['outputs'], severity: 'warning', code: 'NO_OUTPUT', message: 'No output declared' },
    ],
    formatted: '',
  })
  showPage()
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  expect(await screen.findByText(/Tool unavailable/)).toBeTruthy()
  expect(screen.getByText('Connect the tool server')).toBeTruthy()
  expect(screen.getByText(/No output declared/)).toBeTruthy()
  expect(state.check).toHaveBeenCalledWith(definition)
})
test('check shows daemon errors', async () => {
  state.flows = [{ ...flow, definition: { name: 'Greeting' } }]
  state.check.mockRejectedValue(new Error('Check failed'))
  showPage()
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  expect(await screen.findByText('Error: Check failed')).toBeTruthy()
})
