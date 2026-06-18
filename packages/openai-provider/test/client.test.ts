import { describe, expect, test } from 'vitest'

import { parseEventData } from '../src/client.js'

describe('parseEventData', () => {
  test('parses valid JSON SSE data', () => {
    expect(parseEventData('{"a":1}')).toEqual({ a: 1 })
  })

  test('returns undefined for [DONE] sentinel', () => {
    expect(parseEventData('[DONE]')).toBeUndefined()
  })

  test('returns undefined for empty / keep-alive lines', () => {
    expect(parseEventData('')).toBeUndefined()
    expect(parseEventData('   ')).toBeUndefined()
  })

  test('returns undefined (no throw) for non-JSON data', () => {
    expect(parseEventData(': keep-alive comment')).toBeUndefined()
    expect(parseEventData('not json')).toBeUndefined()
  })
})
