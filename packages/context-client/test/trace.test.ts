import { describe, expect, test } from 'vitest'

import { traceMetaFromContext } from '../src/trace.js'

describe('traceMetaFromContext', () => {
  test('returns an empty object when there is no active context', () => {
    expect(traceMetaFromContext(undefined)).toEqual({})
  })

  test('formats a W3C traceparent from an active context', () => {
    const meta = traceMetaFromContext({
      traceID: '0af7651916cd43dd8448eb211c80319c',
      spanID: '00f067aa0ba902b7',
      traceFlags: 1,
    })
    expect(meta).toEqual({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01',
    })
  })

  test('includes tracestate when a non-empty serialized value is provided', () => {
    const meta = traceMetaFromContext(
      { traceID: '0af7651916cd43dd8448eb211c80319c', spanID: '00f067aa0ba902b7', traceFlags: 1 },
      'vendor=value',
    )
    expect(meta.tracestate).toBe('vendor=value')
  })

  test('omits tracestate when the serialized value is empty', () => {
    const meta = traceMetaFromContext(
      { traceID: '0af7651916cd43dd8448eb211c80319c', spanID: '00f067aa0ba902b7', traceFlags: 1 },
      '',
    )
    expect('tracestate' in meta).toBe(false)
  })
})
