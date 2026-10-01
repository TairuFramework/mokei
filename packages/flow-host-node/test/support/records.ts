import type { TaskRecord } from '@mokei/context-server'
import type { RunRecord, StoredLog, StoredSpan } from '@mokei/flow-host'

export const runRecord = (patch: Partial<RunRecord> = {}): RunRecord => ({
  runID: 'run-one',
  revision: 0,
  label: 'Example',
  state: 'working',
  createdAt: 10,
  updatedAt: 20,
  plan: { tools: ['local:example'] },
  request: {
    toolName: 'local:example',
    arguments: { values: [null, true, 1.5, 'text', { nested: ['value'] }] },
  },
  result: {
    output: { values: [null, false, 2.5, 'output'] },
    content: [{ type: 'text', text: 'result' }],
  },
  error: { type: 'example', message: 'diagnostic' },
  ...patch,
})
export const taskRecord = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  taskID: 'task-one',
  revision: 0,
  status: 'working',
  createdAt: '2026-10-01T00:00:00Z',
  lastUpdatedAt: '2026-10-01T00:00:00Z',
  ttlMs: null,
  toolName: 'local:example',
  clientCapabilities: { roots: { listChanged: true } },
  owner: { subject: 'example', scopes: ['read'] },
  requestMeta: { values: [null, true, 1.5, 'text'] },
  resumeData: { nested: ['value'] },
  result: { resultType: 'complete', content: [{ type: 'text', text: 'result' }] },
  error: { code: 1, message: 'diagnostic', data: { nested: [null, true] } },
  inputs: [
    {
      id: 1,
      requests: { roots: { method: 'roots/list', params: { nested: ['value'] } } },
      responses: { roots: { roots: [{ uri: 'file:///flows', name: 'Flows' }] } },
    },
  ],
  ...patch,
})
export const spanRecord = (patch: Partial<StoredSpan> = {}): StoredSpan => ({
  traceID: 'trace-one',
  spanID: 'span-one',
  parentSpanID: 'parent',
  name: 'example',
  kind: 0,
  startTime: 1.25,
  endTime: 2.75,
  status: { code: 0 },
  attributes: { nested: [null, true, 1.5, 'text'] },
  events: [{ name: 'event', time: 1.5, attributes: { nested: ['value'] } }],
  links: [{ traceID: 'other-trace', spanID: 'other-span' }],
  ...patch,
})
export const logRecord = (patch: Partial<StoredLog> = {}): StoredLog => ({
  traceID: 'trace-one',
  spanID: 'span-one',
  timestamp: 1.5,
  level: 'info',
  category: ['example'],
  message: 'example',
  properties: { nested: [null, false, 1.5, 'text'] },
  ...patch,
})

export function mutateNested(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) mutateNested(child)
    value.push('mutated')
  } else if (value != null && typeof value === 'object') {
    for (const child of Object.values(value)) mutateNested(child)
    Object.assign(value, { mutated: true })
  }
}
