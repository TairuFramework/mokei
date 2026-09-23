import { expectTypeOf, test } from 'vitest'

import type { SystemOneBackend, SystemOneResult } from '../src/backend.js'
import type { SystemOneClient } from '../src/client.js'

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
})

test('a backend exposes only the System One API: predict, plus close', () => {
  expectTypeOf<keyof SystemOneBackend>().toEqualTypeOf<'predict' | 'close'>()
})

test('the client exposes only predict', () => {
  expectTypeOf<SystemOneClient>().not.toHaveProperty('predictBatch')
  expectTypeOf<SystemOneClient>().not.toHaveProperty('listModels')
})
