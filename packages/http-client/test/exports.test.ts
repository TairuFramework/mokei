import { expect, test } from 'vitest'

import { DEFAULT_HTTP_REFRESH_TIMEOUT } from '../src/index.js'

test('DEFAULT_HTTP_REFRESH_TIMEOUT is exported from the package root', () => {
  expect(DEFAULT_HTTP_REFRESH_TIMEOUT).toBeDefined()
  expect(DEFAULT_HTTP_REFRESH_TIMEOUT).toBe(10_000)
})
