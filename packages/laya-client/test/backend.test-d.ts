import { expectTypeOf, test } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'

test('a minimal backend needs only predict', () => {
  const backend: LayaBackend = {
    predict: async () =>
      ({
        model: 'english',
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
      }) satisfies LayaResult,
  }
  expectTypeOf(backend.predict).toBeFunction()
  expectTypeOf(backend.batch).toEqualTypeOf<LayaBackend['batch']>()
})
