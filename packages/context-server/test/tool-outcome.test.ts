import { INTERNAL_ERROR } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { describe, expect, test } from 'vitest'

import { createTool, settleToolOutcome } from '../src/index.js'

const countTool = createTool({
  description: 'counts',
  inputSchema: { type: 'object' } as const,
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: ['count'],
  } as const,
  handler: () => ({ structuredContent: { count: 1 } }),
})

describe('settleToolOutcome', () => {
  test('keeps valid structured output and fills missing content', () => {
    const result = { structuredContent: { count: 3 } } as never
    expect(settleToolOutcome(countTool, { result })).toEqual({
      result: {
        content: [{ type: 'text', text: '{"count":3}' }],
        structuredContent: { count: 3 },
      },
    })
  })

  test('reports missing structured output as a protocol error', () => {
    expect(settleToolOutcome(countTool, { result: { content: [] } })).toEqual({
      error: {
        code: INTERNAL_ERROR,
        message: 'Invalid tool output',
        data: {
          issues: [{ message: 'Tool declares an outputSchema but returned no structuredContent' }],
        },
      },
    })
  })

  test('reports invalid structured output as a protocol error', () => {
    const result = { structuredContent: { count: 'three' } } as never
    expect(settleToolOutcome(countTool, { result })).toMatchObject({
      error: {
        code: INTERNAL_ERROR,
        message: 'Invalid tool output',
        data: { issues: [{ path: ['count'], message: expect.any(String) }] },
      },
    })
  })

  test('turns an ordinary tool failure into an isError result', () => {
    expect(settleToolOutcome(countTool, { error: new Error('kaboom') })).toEqual({
      result: { content: [{ type: 'text', text: 'kaboom' }], isError: true },
    })
  })

  test('preserves a thrown protocol error and its data', () => {
    const error = new RPCError({
      code: -32021,
      message: 'Missing capability',
      data: { requiredCapabilities: {} },
    })
    expect(settleToolOutcome(countTool, { error })).toEqual({
      error: { code: -32021, message: 'Missing capability', data: { requiredCapabilities: {} } },
    })
  })
})
