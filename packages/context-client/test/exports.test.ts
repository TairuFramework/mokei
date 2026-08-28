import { expect, test } from 'vitest'

import * as pkg from '../src/index.js'

test('public symbols remain exported from the package root', () => {
  for (const name of [
    'UnsupportedProtocolVersionError',
    'CapabilityNotDeclaredError',
    'MethodNotInRevisionError',
    'MRTRNotSupportedError',
    'InputRequiredNotSupportedError',
    'ListMaxPagesError',
    'StructuredContentValidationError',
    'splitListOptions',
    'ContextClient',
  ]) {
    expect(pkg, name).toHaveProperty(name)
  }
})
