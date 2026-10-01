import { describe, expect, test } from 'vitest'

import { renderLogMessage, toJSONValue } from '../src/to-json-value.js'

describe('toJSONValue', () => {
  test('normalises values without dropping records', () => {
    expect(toJSONValue(12n)).toBe('12')
    expect(toJSONValue(undefined)).toBe('undefined')
    expect(toJSONValue(Symbol('value'))).toBe('Symbol(value)')
    expect(toJSONValue(Object.create(null))).toEqual({})
    expect(
      toJSONValue({
        toJSON() {
          throw new Error('bad')
        },
      }),
    ).toBe('[object Object]')

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(toJSONValue(cyclic)).toBe('[object Object]')

    const fn = () => 'value'
    expect(toJSONValue(fn)).toBe(String(fn))

    const unrenderable = {
      toJSON() {
        throw new Error('bad JSON')
      },
      toString() {
        throw new Error('bad string')
      },
    }
    expect(toJSONValue(unrenderable)).toBe('[unrenderable]')
    expect(toJSONValue({ nested: [true, 'value', 3] })).toEqual({ nested: [true, 'value', 3] })
    expect(toJSONValue(Number.NaN)).toBeNull()
  })
})

describe('renderLogMessage', () => {
  test('renders raw messages and guarded template parts', () => {
    expect(renderLogMessage({ rawMessage: 'raw', message: ['ignored'] })).toBe('raw')
    const rawMessage = [] as unknown as TemplateStringsArray
    expect(renderLogMessage({ rawMessage, message: ['before ', { key: 'value' }, ' ', 12n] })).toBe(
      'before {"key":"value"} 12',
    )
    const unrenderable = {
      toJSON() {
        throw new Error('bad JSON')
      },
      toString() {
        throw new Error('bad string')
      },
    }
    expect(renderLogMessage({ rawMessage, message: ['before ', unrenderable, ' after'] })).toBe(
      'before [unrenderable] after',
    )
  })
})
