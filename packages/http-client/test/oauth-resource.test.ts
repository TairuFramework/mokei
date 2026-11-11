import { describe, expect, test } from 'vitest'

import { canonicalResource } from '../src/oauth/resource.js'

describe('canonicalResource', () => {
  test('drops query and fragment, keeps scheme host port path', () => {
    expect(canonicalResource('https://mcp.example.com/mcp?x=1#y')).toBe(
      'https://mcp.example.com/mcp',
    )
  })
})
