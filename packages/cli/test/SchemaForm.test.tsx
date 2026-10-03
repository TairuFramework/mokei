import { render } from 'ink-testing-library'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { SchemaForm } from '../src/prompts/SchemaForm.js'
import type { FormField } from '../src/prompts/schema-form.js'

const fields: Array<FormField> = [
  { key: 'name', label: 'name', kind: 'text', required: true },
  { key: 'ok', label: 'ok', kind: 'boolean', required: true },
]

describe('SchemaForm', () => {
  test('collects answers field by field', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<SchemaForm fields={fields} onSubmit={onSubmit} onCancel={() => {}} />)
    act(() => {
      stdin.write('a')
    })
    act(() => {
      stdin.write('\r')
    })
    act(() => {
      stdin.write('y')
    })
    expect(onSubmit).toHaveBeenCalledWith({ name: 'a', ok: true })
  })

  test('invalid input shows the error and asks again', () => {
    const onSubmit = vi.fn()
    const onInvalid = vi.fn()
    const { stdin, lastFrame } = render(
      <SchemaForm
        fields={[{ key: 'n', label: 'n', kind: 'number', required: true }]}
        onSubmit={onSubmit}
        onCancel={() => {}}
        onInvalid={onInvalid}
      />,
    )
    act(() => {
      stdin.write('abc')
    })
    act(() => {
      stdin.write('\r')
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onInvalid).toHaveBeenCalledOnce()
    expect(lastFrame() ?? '').toContain('number')
  })

  describe('esc', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    test('on a boolean field cancels instead of answering no', async () => {
      const onSubmit = vi.fn()
      const onCancel = vi.fn()
      const { stdin } = render(
        <SchemaForm
          fields={[{ key: 'ok', label: 'ok', kind: 'boolean', required: true }]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      )
      stdin.write('\x1b')
      vi.runAllTimers()
      await Promise.resolve()
      expect(onCancel).toHaveBeenCalledOnce()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    test('calls onCancel without onSubmit', () => {
      const onSubmit = vi.fn()
      const onCancel = vi.fn()
      const { stdin } = render(
        <SchemaForm fields={fields} onSubmit={onSubmit} onCancel={onCancel} />,
      )
      stdin.write('\x1b')
      vi.runAllTimers()
      expect(onCancel).toHaveBeenCalledOnce()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
