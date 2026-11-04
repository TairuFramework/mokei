import { expect, test } from 'vitest'

import pkg from '../package.json' with { type: 'json' }
import { MOKEI_VERSION } from '../src/index.js'

test('MOKEI_VERSION matches the package version (update src/version.ts after pnpm version -r)', () => {
  expect(MOKEI_VERSION).toBe(pkg.version)
})
