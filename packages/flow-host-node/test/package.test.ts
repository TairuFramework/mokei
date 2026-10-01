import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

import * as entry from '../src/index.js'

describe('flow host node package', () => {
  test('publishes the Node flow host entry point', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

    expect(manifest.name).toBe('@mokei/flow-host-node')
    expect(manifest.version).toBe('0.14.0')
    expect(manifest.type).toBe('module')
    expect(manifest.exports).toEqual({ '.': './lib/index.js' })
    expect(manifest.types).toBe('lib/index.d.ts')
    expect(entry).toBeDefined()
  })
})
