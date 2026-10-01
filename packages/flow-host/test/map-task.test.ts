import type { DetailedTask } from '@mokei/context-protocol'
import { expect, test } from 'vitest'

import { mapTaskSnapshot } from '../src/map-task.js'

export const taskBase = {
  taskId: 'task',
  createdAt: new Date(0).toISOString(),
  lastUpdatedAt: new Date(1).toISOString(),
  ttlMs: null,
}
test('completed result preserves outcome, output and content', () => {
  const result = {
    content: [{ type: 'text' as const, text: 'done' }],
    structuredContent: { outcome: 'done', output: { value: 1 } },
  }
  expect(mapTaskSnapshot({ ...taskBase, status: 'completed', result })).toEqual({
    state: 'completed',
    result: { content: result.content, outcome: 'done', output: { value: 1 } },
  })
})
test.each([
  [
    { code: 'tool_failed', name: 'FlowError', lastFailure: { type: 'SystemOneError' } },
    'SystemOneError',
  ],
  [{ code: 'tool_failed', name: 'NamedError' }, 'NamedError'],
  [{ code: 'tool_failed' }, 'FlowError'],
])('flow errors use the most specific type', (error, type) => {
  expect(
    mapTaskSnapshot({
      ...taskBase,
      status: 'completed',
      result: {
        isError: true,
        content: [{ type: 'text', text: 'failed' }],
        structuredContent: { error },
      },
    }),
  ).toEqual({ state: 'failed', error: { type, code: 'tool_failed', message: 'failed' } })
})
test('task failures preserve message and code', () => {
  expect(
    mapTaskSnapshot({ ...taskBase, status: 'failed', error: { code: -1, message: 'broken' } }),
  ).toEqual({ state: 'failed', error: { type: 'TaskFailed', message: 'broken' } })
})
test.each(['working', 'input_required', 'cancelled'] as const)('maps %s', (status) => {
  expect(mapTaskSnapshot({ ...taskBase, status, inputRequests: {} } as DetailedTask)).toEqual({
    state: status,
  })
})
