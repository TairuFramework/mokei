import { createValidator } from '@sozai/schema'
import { expect, expectTypeOf, test } from 'vitest'

import {
  type FlowProcedure,
  hostEventSchema,
  hostInfoResultSchema,
  protocol,
  traceLogSchema,
  tracesGetParamsSchema,
  tracesGetResultSchema,
  tracesListParamsSchema,
  tracesListResultSchema,
} from '../src/index.js'

const validateEvent = createValidator(hostEventSchema)
const validateInfo = createValidator(hostInfoResultSchema)
const validateList = createValidator(tracesListResultSchema)
const validateGet = createValidator(tracesGetResultSchema)
const validateListParams = createValidator(tracesListParamsSchema)
const validateGetParams = createValidator(tracesGetParamsSchema)

const span = {
  traceID: 'trace-1',
  spanID: 'span-1',
  name: 'root',
  kind: 1,
  startTime: 1,
  endTime: 2,
  status: { code: 1 },
  attributes: {},
  events: [],
  links: [],
}
const summary = {
  traceID: 'trace-1',
  rootSpanID: 'span-1',
  kind: 'flow',
  name: 'Example',
  active: false,
  outcome: 'ok',
  startTime: 1,
  endTime: 2,
  attributes: {},
  spanCount: 1,
  errorCount: 0,
  droppedCount: 0,
  revision: 1,
}
const log = {
  traceID: 'trace-1',
  spanID: 'span-1',
  logID: 'log-1',
  timestamp: 2,
  level: 'info',
  category: ['test'],
  message: 'done',
  properties: {},
}

test('validates trace events and trace procedures', () => {
  for (const [type, data] of [
    [
      'span:start',
      {
        traceID: 'trace-1',
        spanID: 'span-1',
        name: 'root',
        kind: 1,
        startTime: 1,
        attributes: {},
        links: [],
      },
    ],
    ['span:end', span],
    ['log', log],
    ['trace:summary', summary],
  ] as const) {
    expect(
      validateEvent({ type, meta: { eventID: 'event-1', time: 2 }, data }).issues,
    ).toBeUndefined()
  }
  expect(validateList({ traces: [summary], cursor: 'next' }).issues).toBeUndefined()
  expect(validateListParams({ limit: 50, kind: 'flow', active: false }).issues).toBeUndefined()
  expect(validateGetParams({ traceID: 'trace-1' }).issues).toBeUndefined()
  expect(
    validateGet({ summary, spans: [span], logs: [log], logsTruncated: false }).issues,
  ).toBeUndefined()
  expect(
    validateInfo({
      activeContexts: {},
      startedTime: 1,
      flowService: { state: 'ready' },
      tracing: { lostSummaryCount: 0, droppedCount: 0 },
    }).issues,
  ).toBeUndefined()
  expect(protocol['traces.list'].type).toBe('request')
  expect(protocol['traces.get'].type).toBe('request')
  expect(createValidator(traceLogSchema)(log).issues).toBeUndefined()
})

test('trace procedures are excluded from flow procedures', () => {
  expectTypeOf<'traces.list'>().not.toMatchTypeOf<FlowProcedure>()
})
