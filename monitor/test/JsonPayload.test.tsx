import { MantineProvider } from '@mantine/core'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { JsonPayload } from '../src/components/JsonPayload.js'

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

test('renders object payloads as a tree', () => {
  render(
    <MantineProvider>
      <JsonPayload value={{ result: { count: 2 } }} label="Response" />
    </MantineProvider>,
  )
  const tree = screen.getByRole('tree', { name: 'Response' })
  expect(within(tree).getByText('result:')).toBeTruthy()
  expect(within(tree).getByText('count:')).toBeTruthy()
})

test.each(['{"result":[{"count":2}]}', '[{"result":2}]'])(
  'parses JSON string %s into a tree',
  (value) => {
    render(
      <MantineProvider>
        <JsonPayload value={value} />
      </MantineProvider>,
    )
    expect(within(screen.getByRole('tree')).getByText('result:')).toBeTruthy()
  },
)

test.each(['{"a": "b', '"hello"', '42', 'null'])('keeps raw string %s', (value) => {
  render(
    <MantineProvider>
      <JsonPayload value={value} />
    </MantineProvider>,
  )
  expect(screen.queryByRole('tree')).toBeNull()
  expect(screen.getByText(value)).toBeTruthy()
})

test('renders the empty label for undefined', () => {
  render(
    <MantineProvider>
      <JsonPayload value={undefined} empty="No captured payload." />
    </MantineProvider>,
  )
  expect(screen.getByText('No captured payload.')).toBeTruthy()
  expect(screen.queryByRole('tree')).toBeNull()
})

test('preserves explicit null payloads', () => {
  render(
    <MantineProvider>
      <JsonPayload value={null} empty="No captured payload." />
    </MantineProvider>,
  )
  expect(screen.getByText('null')).toBeTruthy()
  expect(screen.queryByText('No captured payload.')).toBeNull()
})
