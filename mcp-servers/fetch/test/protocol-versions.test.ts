import { describe, expect, test } from 'vitest'

import { createFetchConfig } from '../src/config.js'

describe('the bundled fetch server', () => {
  test('serves both revisions', () => {
    const config = createFetchConfig()
    expect(config.protocolVersions).toEqual(expect.arrayContaining(['2025-11-25', '2026-07-28']))
  })
})
