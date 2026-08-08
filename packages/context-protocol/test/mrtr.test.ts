import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import { inputRequest, inputResponse } from '../src/versions/2026-07-28.js'

const validateInputRequest = createValidator(inputRequest)
const validateInputResponse = createValidator(inputResponse)

const SAMPLING_REQUEST = {
  method: 'sampling/createMessage',
  params: { maxTokens: 100, messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] },
}

describe('inputRequest', () => {
  test('accepts a de-JSON-RPC-d sampling request', () => {
    expect(validateInputRequest(SAMPLING_REQUEST).issues).toBeUndefined()
  })

  test('accepts an elicitation request and a roots request', () => {
    expect(
      validateInputRequest({
        method: 'elicitation/create',
        params: { message: 'pick one', requestedSchema: { type: 'object', properties: {} } },
      }).issues,
    ).toBeUndefined()
    expect(validateInputRequest({ method: 'roots/list' }).issues).toBeUndefined()
  })

  test('rejects a JSON-RPC envelope and an unknown method', () => {
    expect(
      validateInputRequest({ jsonrpc: '2.0', id: 1, ...SAMPLING_REQUEST }).issues,
    ).toBeDefined()
    expect(
      validateInputRequest({ method: 'tools/call', params: { name: 'x' } }).issues,
    ).toBeDefined()
  })

  test('rejects a sampling request missing its required params', () => {
    expect(
      validateInputRequest({ method: 'sampling/createMessage', params: {} }).issues,
    ).toBeDefined()
  })
})

describe('inputResponse', () => {
  test('accepts a bare sampling result and a bare roots result', () => {
    expect(
      validateInputResponse({
        content: { type: 'text', text: 'ok' },
        model: 'test',
        role: 'assistant',
      }).issues,
    ).toBeUndefined()
    expect(validateInputResponse({ roots: [] }).issues).toBeUndefined()
  })

  test('rejects a shape matching no input response', () => {
    expect(validateInputResponse({ nonsense: true }).issues).toBeDefined()
  })
})
