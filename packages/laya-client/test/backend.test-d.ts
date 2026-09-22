import { expectTypeOf, test } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'

test('a minimal backend needs only predict', () => {
  const backend: LayaBackend = {
    predict: async () =>
      ({
        model: 'english',
        answers: {},
        usage: { inputTokens: 0, outputTokens: 0 },
      }) satisfies LayaResult,
  }
  expectTypeOf(backend.predict).toBeFunction()
  expectTypeOf(backend.batch).toEqualTypeOf<LayaBackend['batch']>()
})
