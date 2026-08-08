import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import {
  clientRequest as clientRequest20260728,
  inputRequest,
  inputResponse,
  serverResult as serverResult20260728,
} from '../src/versions/2026-07-28.js'
import { PROTOCOLS } from '../src/versions/index.js'

const validateInputRequest = createValidator(inputRequest)
const validateInputResponse = createValidator(inputResponse)
const validateResult = createValidator(serverResult20260728)

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

describe('2026-07-28 input_required results', () => {
  test('rejects a terminal result labelled input_required', () => {
    expect(validateResult({ tools: [], resultType: 'input_required' }).issues).toBeDefined()
    expect(validateResult({ content: [], resultType: 'input_required' }).issues).toBeDefined()
    expect(validateResult({ resultType: 'input_required' }).issues).toBeDefined()
  })

  test('accepts a suspended result carrying inputRequests', () => {
    expect(
      validateResult({
        resultType: 'input_required',
        inputRequests: { ask: SAMPLING_REQUEST },
      }).issues,
    ).toBeUndefined()
  })

  test('accepts a suspended result carrying only requestState', () => {
    expect(
      validateResult({ resultType: 'input_required', requestState: 'opaque' }).issues,
    ).toBeUndefined()
  })

  test('rejects a suspended result carrying an unknown embedded method', () => {
    expect(
      validateResult({
        resultType: 'input_required',
        inputRequests: { ask: { method: 'tools/call', params: { name: 'x' } } },
      }).issues,
    ).toBeDefined()
  })
})

const validateClientRequest = createValidator(clientRequest20260728)

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

describe('2026-07-28 retry params', () => {
  test('accepts inputResponses and requestState on a tools/call', () => {
    expect(
      validateClientRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          _meta: META,
          name: 'ask',
          inputResponses: { ask: { roots: [] } },
          requestState: 'opaque',
        },
      }).issues,
    ).toBeUndefined()
  })

  test('rejects an inputResponses value that is not an input response', () => {
    expect(
      validateClientRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { _meta: META, name: 'ask', inputResponses: { ask: { nonsense: true } } },
      }).issues,
    ).toBeDefined()
  })
})

describe('inputRequestMethods', () => {
  test('2026-07-28 carries the three MRTR methods and 2025-11-25 carries none', () => {
    expect([...PROTOCOLS['2026-07-28'].inputRequestMethods].sort()).toEqual([
      'elicitation/create',
      'roots/list',
      'sampling/createMessage',
    ])
    expect(PROTOCOLS['2025-11-25'].inputRequestMethods.size).toBe(0)
  })

  test('a revision never carries a method both ways', () => {
    for (const protocol of Object.values(PROTOCOLS)) {
      for (const method of protocol.inputRequestMethods) {
        expect(protocol.serverMethods.has(method)).toBe(false)
      }
    }
  })
})

describe('wrapResult', () => {
  const context = { serverInfo: { name: 'test', version: '1.0.0' } }

  test('labels a terminal result complete', () => {
    expect(PROTOCOLS['2026-07-28'].wrapResult({ tools: [] }, context).resultType).toBe('complete')
  })

  test('preserves an input_required body', () => {
    const wrapped = PROTOCOLS['2026-07-28'].wrapResult(
      { resultType: 'input_required', requestState: 'opaque' },
      context,
    )
    expect(wrapped.resultType).toBe('input_required')
    expect(wrapped.requestState).toBe('opaque')
  })
})
