import { ContextClient } from '@mokei/context-client'
import { describe, expect, test, vi } from 'vitest'

import { createHTTPClient } from '../src/index.js'

vi.stubGlobal('fetch', vi.fn())

describe('createHTTPClient', () => {
  test('returns a ContextClient instance', () => {
    const client = createHTTPClient({ url: 'http://localhost:3000/mcp' })
    expect(client).toBeInstanceOf(ContextClient)
  })
})
