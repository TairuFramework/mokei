import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { SchemaForm } from '../src/components/SchemaForm.js'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal('visualViewport', { addEventListener() {}, removeEventListener() {} })
})
afterEach(() => vi.unstubAllGlobals())

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    amount: { type: 'number', title: 'Amount' },
    count: { type: 'integer', title: 'Count', default: 0 },
    enabled: { type: 'boolean', title: 'Enabled', default: false },
    choice: {
      type: 'string',
      enum: ['a', 'b'],
      enumNames: ['Alpha', 'Beta'],
      default: 'b',
      title: 'Choice',
    },
  },
  required: ['name', 'enabled'],
}

test('blocks missing required values and accepts typed values including false and zero', () => {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm schema={schema} onSubmit={onSubmit} />
    </MantineProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByText('Required')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).toHaveBeenCalledWith({
    name: 'Ada',
    amount: 2.5,
    count: 0,
    enabled: false,
    choice: 'b',
  })
})

test('shows daemon errors and exposes decline and cancel', () => {
  const onDecline = vi.fn()
  const onCancel = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm
        schema={schema}
        onSubmit={vi.fn()}
        onDecline={onDecline}
        onCancel={onCancel}
        errors={['Invalid answer']}
      />
    </MantineProvider>,
  )
  expect(screen.getByText('Invalid answer')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onDecline).toHaveBeenCalledOnce()
  expect(onCancel).toHaveBeenCalledOnce()
})

test('unsupported schemas use JSON input and reject non-object content', () => {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm
        schema={{ type: 'object', properties: { nested: { type: 'object' } } }}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  )
  fireEvent.change(screen.getByLabelText('JSON input'), { target: { value: '[]' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('JSON input'), {
    target: { value: '{"nested":{"name":"Ada"}}' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).toHaveBeenCalledWith({ nested: { name: 'Ada' } })
})

test('clearing an optional enum omits it from the submitted answer', () => {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm
        schema={{
          type: 'object',
          properties: { choice: { type: 'string', enum: ['a', 'b'], default: 'b' } },
        }}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  )
  fireEvent.change(screen.getByLabelText('choice'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).toHaveBeenCalledWith({})
})

test('submits an empty string selected from a required enum', () => {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm
        schema={{
          type: 'object',
          properties: { choice: { type: 'string', enum: ['', 'a'] } },
          required: ['choice'],
        }}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  )
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).toHaveBeenCalledWith({ choice: '' })
})

test('submits an empty string selected from an optional enum', () => {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm
        schema={{ type: 'object', properties: { choice: { type: 'string', enum: ['', 'a'] } } }}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  )
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).toHaveBeenCalledWith({ choice: '' })
})

test('submits prototype-named properties as own answer properties', () => {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <SchemaForm
        schema={{
          type: 'object',
          properties: {
            constructor: { type: 'string' },
            toString: { type: 'string' },
            ['__proto__']: { type: 'string' },
          },
          required: ['constructor', 'toString', '__proto__'],
        }}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'constructor' }), {
    target: { value: 'ctor' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'toString' }), {
    target: { value: 'stringifier' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '__proto__' }), {
    target: { value: 'proto' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onSubmit).toHaveBeenCalledOnce()
  const answer = onSubmit.mock.calls[0][0]
  expect(Object.hasOwn(answer, 'constructor')).toBe(true)
  expect(Object.hasOwn(answer, 'toString')).toBe(true)
  expect(Object.hasOwn(answer, '__proto__')).toBe(true)
  expect(answer.constructor).toBe('ctor')
  expect(answer.toString).toBe('stringifier')
  expect(Object.getOwnPropertyDescriptor(answer, '__proto__')?.value).toBe('proto')
})
