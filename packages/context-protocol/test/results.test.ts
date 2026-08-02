import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import { clientResult } from '../src/client.js'
import { serverResult } from '../src/server.js'

const validateServerResult = createValidator(serverResult)
const validateClientResult = createValidator(clientResult)

describe('serverResult', () => {
  test('accepts an empty result', () => {
    expect(validateServerResult({}).issues).toBeUndefined()
    expect(validateServerResult({ _meta: { trace: 'x' } }).issues).toBeUndefined()
  })

  test('accepts a known result', () => {
    expect(validateServerResult({ tools: [] }).issues).toBeUndefined()
  })

  test('rejects an object matching no known result', () => {
    expect(validateServerResult({ nonsense: true }).issues).toBeDefined()
  })
})

describe('clientResult', () => {
  test('accepts an empty result and rejects an unknown shape', () => {
    expect(validateClientResult({}).issues).toBeUndefined()
    expect(validateClientResult({ nonsense: true }).issues).toBeDefined()
  })
})
