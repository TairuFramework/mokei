import type { ElicitFormField } from '@mokei/context-protocol'
import { render } from 'ink-testing-library'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { SchemaForm } from '../src/prompts/SchemaForm.js'

const fields: Array<ElicitFormField> = [
  { name: 'name', title: 'name', kind: 'text', required: true },
  { name: 'ok', title: 'ok', kind: 'boolean', required: true },
]

describe('SchemaForm', () => {
  test('submits selected multi-choice values as an array', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <SchemaForm
        fields={[
          {
            name: 'tags',
            kind: 'multi',
            required: true,
            choices: [
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
            ],
          },
        ]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    act(() => {
      stdin.write(' ')
    })
    act(() => {
      stdin.write('\r')
    })
    expect(onSubmit).toHaveBeenCalledWith({ tags: ['a'] })
  })

  test('an empty form submits {} once', () => {
    const onSubmit = vi.fn()
    render(<SchemaForm fields={[]} onSubmit={onSubmit} onCancel={() => {}} />)
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({})
  })

  test('a __proto__ field survives as an own property', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <SchemaForm
        fields={[{ name: '__proto__', title: 'p', kind: 'text', required: true }]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    act(() => {
      stdin.write('v')
    })
    act(() => {
      stdin.write('\r')
    })
    const result = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('v')
  })

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
        fields={[{ name: 'n', title: 'n', kind: 'number', required: true }]}
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
          fields={[{ name: 'ok', title: 'ok', kind: 'boolean', required: true }]}
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

describe('FormRunner', () => {
  test('an empty form exits the runner', async () => {
    const { FormRunner } = await import('../src/prompts/SchemaForm.js')
    const onDone = vi.fn()
    render(<FormRunner fields={[]} onDone={onDone} />)
    expect(onDone).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith({})
  })
})
