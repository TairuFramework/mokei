import type { TracesGetResult, TracesListParams } from '@mokei/host-protocol'
import { expect, test } from 'vitest'

import { createTraceHandlers } from '../src/trace-handlers.js'

const trace: TracesGetResult = {
  summary: {
    traceID: 'trace-one',
    rootSpanID: 'root-one',
    kind: 'mcp',
    name: 'tools/call',
    active: false,
    outcome: 'ok',
    startTime: 1,
    endTime: 2,
    attributes: {},
    spanCount: 1,
    errorCount: 0,
    droppedCount: 0,
    revision: 2,
  },
  spans: [],
  logs: [],
  logsTruncated: false,
}

test('traces.list and traces.get delegate to the reader; unknown trace is NotFound', async () => {
  const params: TracesListParams = { kind: 'mcp', active: false, limit: 10, cursor: 'next-page' }
  let received: TracesListParams | undefined
  const handlers = createTraceHandlers({
    reader: {
      list: async (param) => {
        received = param
        return { traces: [trace.summary], cursor: 'last-page' }
      },
      get: async (traceID) => (traceID === 'trace-one' ? trace : undefined),
    },
  })
  const signal = new AbortController().signal
  const listed = await handlers['traces.list']({
    param: params,
    signal,
    message: {
      header: { typ: 'JWT', alg: 'none' },
      payload: { typ: 'request', prc: 'traces.list', rid: 'list-request', prm: params },
    },
  })
  expect(listed).toEqual({ traces: [trace.summary], cursor: 'last-page' })
  expect(received).toEqual(params)
  const get = (traceID: string) =>
    handlers['traces.get']({
      param: { traceID },
      signal,
      message: {
        header: { typ: 'JWT', alg: 'none' },
        payload: { typ: 'request', prc: 'traces.get', rid: 'get-request', prm: { traceID } },
      },
    })
  await expect(get('trace-one')).resolves.toEqual(trace)
  await expect(get('missing')).rejects.toMatchObject({ code: 'TRACE_NOT_FOUND' })
})
