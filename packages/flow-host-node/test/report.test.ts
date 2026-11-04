import { reset, setup } from '@sozai/log'
import { afterEach, expect, test, vi } from 'vitest'

import { FLOW_REPORT_CATEGORY, getFlowReporter } from '../src/report.js'

afterEach(() => {
  reset()
  vi.restoreAllMocks()
})

test('renders the error in the record message when logging is configured', () => {
  const records: Array<{ message: ReadonlyArray<unknown> }> = []
  setup({
    sinks: { test: (record) => records.push(record) },
    loggers: [
      { category: [...FLOW_REPORT_CATEGORY], lowestLevel: 'error', sinks: ['test'] },
      { category: ['logtape', 'meta'], lowestLevel: 'error', sinks: [] },
    ],
  })
  const error = new Error('Invalid registered flow broken')
  getFlowReporter('@mokei/flow-host-node')('Failed in /flows/{x}.json', error)
  expect(records).toHaveLength(1)
  expect(records[0]?.message).toEqual(['Failed in /flows/{x}.json: ', error, ''])
})

test('falls back to the console with the error beside the message', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new Error('boom')
  getFlowReporter('@mokei/flow-host-node')('Flow service error', error)
  expect(log).toHaveBeenCalledWith('[@mokei/flow-host-node] Flow service error', error)
})
