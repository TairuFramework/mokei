import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'

import { createSQLiteConfig } from '../src/index.js'

describe('the bundled SQLite server', () => {
  test('serves both revisions', () => {
    const db = new DatabaseSync(':memory:')
    const config = createSQLiteConfig(db)
    expect(config.protocolVersions).toEqual(expect.arrayContaining(['2025-11-25', '2026-07-28']))
  })
})
