import { describe, expect, test } from 'vitest'

import { normalizeFinishReason, telemetryFromBaseURL } from '../src/index.js'

describe('normalizeFinishReason', () => {
  test.each([
    ['stop', 'stop'],
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['length', 'length'],
    ['max_tokens', 'length'],
    ['tool_calls', 'tool_call'],
    ['tool_use', 'tool_call'],
    ['content_filter', 'content_filter'],
    ['refusal', 'content_filter'],
    ['abort', 'error'],
    [undefined, 'error'],
    ['something_else', 'something_else'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeFinishReason(input)).toBe(expected)
  })
})

describe('telemetryFromBaseURL', () => {
  test('uses explicit port', () => {
    expect(telemetryFromBaseURL('ollama', 'http://localhost:11434/api')).toEqual({
      providerName: 'ollama',
      serverAddress: 'localhost',
      serverPort: 11434,
    })
  })

  test('defaults port by scheme', () => {
    expect(telemetryFromBaseURL('x', 'https://api.example.com/v1')).toMatchObject({
      serverAddress: 'api.example.com',
      serverPort: 443,
    })
    expect(telemetryFromBaseURL('x', 'http://example.com')).toMatchObject({ serverPort: 80 })
  })

  test('strips IPv6 brackets', () => {
    expect(telemetryFromBaseURL('x', 'http://[::1]:8080/v1')).toMatchObject({
      serverAddress: '::1',
      serverPort: 8080,
    })
  })

  test('invalid URL yields provider name only', () => {
    expect(telemetryFromBaseURL('x', 'not a url')).toEqual({ providerName: 'x' })
  })
})
