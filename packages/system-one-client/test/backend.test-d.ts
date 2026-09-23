import { expectTypeOf, test } from 'vitest'

import type { SystemOneBackend, SystemOneResult } from '../src/backend.js'

test('a minimal backend needs only predict', () => {
  const backend: SystemOneBackend = {
    predict: async () =>
      ({
        model: 'english',
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
      }) satisfies SystemOneResult,
  }
  expectTypeOf(backend.predict).toBeFunction()
  expectTypeOf(backend.batch).toEqualTypeOf<SystemOneBackend['batch']>()
})
