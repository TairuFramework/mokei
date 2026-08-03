import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import { clientResult } from '../src/client.js'
import { serverResult } from '../src/server.js'
import { serverResult as serverResult20260728 } from '../src/versions/2026-07-28.js'

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

const validate20260728 = createValidator(serverResult20260728)

describe('2026-07-28 serverResult', () => {
  test('requires resultType on a known result', () => {
    expect(validate20260728({ tools: [] }).issues).toBeDefined()
    expect(validate20260728({ tools: [], resultType: 'complete' }).issues).toBeUndefined()
  })

  test('requires resultType on an empty result', () => {
    expect(validate20260728({}).issues).toBeDefined()
    expect(validate20260728({ resultType: 'complete' }).issues).toBeUndefined()
  })

  test('accepts a discover result through the union', () => {
    expect(
      validate20260728({
        capabilities: {},
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
      }).issues,
    ).toBeUndefined()
  })

  test('rejects an object matching no known result', () => {
    expect(validate20260728({ nonsense: true, resultType: 'complete' }).issues).toBeDefined()
  })

  test('accepts a spec-shaped input_required result and rejects a complete one carrying it', () => {
    expect(
      validate20260728({
        resultType: 'input_required',
        inputRequests: { foo: { role: 'user' } },
        requestState: 'opaque-blob',
      }).issues,
    ).toBeUndefined()
    expect(validate20260728({ resultType: 'complete', inputRequests: {} }).issues).toBeDefined()
  })
})
