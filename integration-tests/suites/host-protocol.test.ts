import { createValidator, type Schema } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import * as hostProtocol from '../../packages/host-protocol/src/index.js'

const runID = '22e7a161-6959-4f82-b082-719ab83b7ec1'
const meta = { eventID: 'f5256378-5fb7-445a-860f-4771fdb205f5', time: 1_790_935_200_000 }
const emptyFlow = {
  id: 'empty',
  name: 'Empty',
  version: 1,
  start: 'done',
  nodes: { done: { kind: 'end' } },
}
const run = {
  runID,
  label: 'Empty run',
  state: 'working',
  createdAt: meta.time,
  updatedAt: meta.time,
  plan: { tools: ['local:notify'] },
}
const approval = {
  id: `${runID}:approval`,
  runID,
  kind: 'approval',
  plan: run.plan,
  createdAt: meta.time,
}
const input = {
  id: `${runID}:1`,
  runID,
  kind: 'input',
  inputKey: '1',
  message: 'Choose a name',
  requestedSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    'x-display': 'form',
  },
  createdAt: meta.time,
}

function valid(schema: Schema, value: unknown): boolean {
  return createValidator(schema)(value).issues === undefined
}

test.each(['signed', 'unsigned', 'any'] as const)(
  'compiles recursive JSON schemas inside %s Enkaku envelopes',
  (type) => {
    const before = structuredClone(hostProtocol.protocol)
    const client = createValidator(createClientMessageSchema(hostProtocol.protocol, type))
    const server = createValidator(createServerMessageSchema(hostProtocol.protocol, type))
    expect(hostProtocol.protocol).toEqual(before)
    const signed = type === 'signed'
    const envelope = signed
      ? { header: { typ: 'JWT', alg: 'EdDSA' }, signature: 'schema-validation-signature' }
      : { header: { typ: 'JWT', alg: 'none' } }
    const claims = signed ? { iss: 'did:key:validation-fixture' } : {}
    const request = {
      ...envelope,
      payload: {
        ...claims,
        typ: 'request',
        prc: 'runs.start',
        rid: runID,
        prm: { definition: emptyFlow, input: { nested: [null, true, { number: 42 }] } },
      },
    }
    expect(client(request).issues).toBeUndefined()
    expect(
      client({
        ...request,
        payload: {
          ...request.payload,
          prm: { ...request.payload.prm, input: { bad: [() => {}] } },
        },
      }).issues,
    ).toBeDefined()
    const response = {
      ...envelope,
      payload: {
        ...claims,
        typ: 'result',
        rid: runID,
        val: {
          ...run,
          result: { content: [{ type: 'text', text: 'ok', nested: [null, { ok: true }] }] },
        },
      },
    }
    expect(server(response).issues).toBeUndefined()
    expect(
      server({
        ...response,
        payload: {
          ...response.payload,
          val: {
            ...response.payload.val,
            result: { content: [{ type: 'text', text: 'ok', nested: [() => {}] }] },
          },
        },
      }).issues,
    ).toBeDefined()
  },
)

test('preserves local definition references inside schema ID resources', () => {
  const resource = {
    $id: 'https://mokei.dev/test/schema-resource',
    definitions: { value: { type: 'number' } },
    type: 'object',
    properties: { value: { $ref: '#/definitions/value' } },
  } as const
  const protocol = { check: { type: 'request', param: resource, result: resource } } as const
  const before = structuredClone(protocol)
  const clientSchema = createClientMessageSchema(protocol, 'unsigned')
  const serverSchema = createServerMessageSchema(protocol, 'unsigned')
  expect(JSON.stringify(clientSchema)).toContain('"$ref":"#/definitions/value"')
  expect(JSON.stringify(serverSchema)).toContain('"$ref":"#/definitions/value"')
  expect(protocol).toEqual(before)
  const client = createValidator(clientSchema)
  const request = {
    header: { typ: 'JWT', alg: 'none' },
    payload: { typ: 'request', prc: 'check', rid: runID, prm: { value: 42 } },
  }
  expect(client(request).issues).toBeUndefined()
  expect(
    client({ ...request, payload: { ...request.payload, prm: { value: 'invalid' } } }).issues,
  ).toBeDefined()
})

describe('host events', () => {
  test('flow events require run identity without context identity', () => {
    const runEvent = { type: 'run:state', meta, data: run }
    expect(valid(hostProtocol.hostEventSchema, runEvent)).toBe(true)
    expect(
      valid(hostProtocol.hostEventSchema, { ...runEvent, meta: { ...meta, contextID: 'fake' } }),
    ).toBe(false)
    expect(
      valid(hostProtocol.hostEventSchema, { ...runEvent, data: { ...run, runID: undefined } }),
    ).toBe(false)
    expect(
      valid(hostProtocol.hostEventSchema, { ...runEvent, data: { ...run, state: 'unknown' } }),
    ).toBe(false)
  })

  test('context events retain their existing metadata', () => {
    const contextMeta = { ...meta, contextID: 'legacy-context' }
    for (const event of [
      {
        type: 'context:start',
        meta: contextMeta,
        data: { transport: 'stdio', command: 'node', args: [] },
      },
      { type: 'context:stop', meta: contextMeta },
      {
        type: 'context:message',
        meta: contextMeta,
        data: { from: 'server', message: { jsonrpc: '2.0', id: 1, result: {} } },
      },
    ]) {
      expect(valid(hostProtocol.hostEventSchema, event)).toBe(true)
      expect(valid(hostProtocol.hostEventSchema, { ...event, meta })).toBe(false)
    }
  })

  test('inbox events distinguish approvals, inputs and settlement outcomes', () => {
    for (const item of [approval, input]) {
      expect(valid(hostProtocol.hostEventSchema, { type: 'inbox:added', meta, data: item })).toBe(
        true,
      )
      for (const outcome of ['answered', 'declined', 'cancelled', 'withdrawn']) {
        expect(
          valid(hostProtocol.hostEventSchema, {
            type: 'inbox:settled',
            meta,
            data: { item, outcome },
          }),
        ).toBe(true)
      }
    }
    expect(
      valid(hostProtocol.hostEventSchema, {
        type: 'inbox:added',
        meta,
        data: { ...approval, inputKey: '1' },
      }),
    ).toBe(false)
    expect(
      valid(hostProtocol.hostEventSchema, {
        type: 'inbox:added',
        meta,
        data: { ...input, requestedSchema: undefined },
      }),
    ).toBe(false)
    expect(
      valid(hostProtocol.hostEventSchema, {
        type: 'inbox:settled',
        meta,
        data: { item: input, outcome: 'pending' },
      }),
    ).toBe(false)
  })

  test('service events and info reject unknown status properties', () => {
    for (const status of [
      { state: 'starting' },
      { state: 'ready' },
      {
        state: 'failed',
        error: {
          type: 'ConfigError',
          message: 'Invalid configuration',
          path: '/tmp/config.json',
          issues: ['Invalid key'],
        },
      },
    ]) {
      expect(
        valid(hostProtocol.hostEventSchema, {
          type: 'service:status',
          meta,
          data: { service: 'flow', status },
        }),
      ).toBe(true)
      expect(
        valid(hostProtocol.hostInfoResultSchema, {
          activeContexts: {},
          startedTime: meta.time,
          flowService: status,
        }),
      ).toBe(true)
      expect(
        valid(hostProtocol.hostInfoResultSchema, {
          activeContexts: {},
          startedTime: meta.time,
          flowService: { ...status, extra: true },
        }),
      ).toBe(false)
    }
    expect(
      valid(hostProtocol.hostEventSchema, {
        type: 'service:status',
        meta: { ...meta, contextID: 'fake' },
        data: { service: 'flow', status: { state: 'ready' } },
      }),
    ).toBe(false)
    expect(
      valid(hostProtocol.hostInfoResultSchema, {
        activeContexts: {},
        startedTime: meta.time,
        flowService: { state: 'failed' },
      }),
    ).toBe(false)
  })

  test('the events stream validates the complete event union', () => {
    expect(
      valid(hostProtocol.protocol.events.receive, { type: 'run:state', meta, data: run }),
    ).toBe(true)
    expect(valid(hostProtocol.protocol.events.receive, { type: 'unknown', meta, data: run })).toBe(
      false,
    )
  })
})

describe('flow procedures', () => {
  test('start requests distinguish registered flows from inline definitions', () => {
    const schema = hostProtocol.protocol['runs.start'].param
    expect(
      valid(schema, {
        flow: 'empty',
        input: { nested: [1, true, null, { name: 'A' }] },
        label: 'Registered',
      }),
    ).toBe(true)
    expect(
      valid(schema, { definition: { ...emptyFlow, input: { type: 'object', 'x-extension': {} } } }),
    ).toBe(true)
    expect(valid(schema, { flow: 'empty', definition: emptyFlow })).toBe(false)
    expect(valid(schema, {})).toBe(false)
    expect(valid(schema, { flow: 'empty', input: { nested: { fn: () => {} } } })).toBe(false)
  })

  test('validation results contain only public JSON values', () => {
    const schema = hostProtocol.protocol['flows.check'].result
    const checked = { value: emptyFlow, warnings: [], formatted: '' }
    expect(valid(schema, checked)).toBe(true)
    expect(valid(schema, { ...checked, graphFor: () => {} })).toBe(false)
    expect(valid(schema, { ...checked, lookup: () => {} })).toBe(false)
    expect(valid(schema, { ...checked, value: { ...emptyFlow, secret: { fn: () => {} } } })).toBe(
      false,
    )
    const issue = {
      path: ['nodes', 0, 'schema'],
      severity: 'error',
      code: 'invalid_schema',
      message: 'Invalid schema',
      hint: 'Use a JSON schema',
    }
    expect(
      valid(schema, {
        issues: [issue],
        warnings: [{ ...issue, severity: 'warning' }],
        formatted: 'Invalid schema',
      }),
    ).toBe(true)
    expect(valid(schema, { ...checked, issues: [issue] })).toBe(false)
    expect(
      valid(schema, {
        issues: [{ ...issue, path: [Symbol('path')] }],
        warnings: [],
        formatted: '',
      }),
    ).toBe(false)
    expect(
      valid(hostProtocol.protocol['flows.check'].param, {
        definition: { ...emptyFlow, extension: { allowed: true } },
      }),
    ).toBe(true)
  })

  test('run snapshots preserve public results and reject persistence fields', () => {
    const schema = hostProtocol.protocol['runs.get'].result
    for (const state of [
      'awaiting_approval',
      'denied',
      'working',
      'input_required',
      'completed',
      'failed',
      'cancelled',
    ]) {
      expect(
        valid(schema, {
          ...run,
          state,
          flowID: 'empty',
          traceID: '12345678901234567890123456789012',
          result: {
            outcome: 'done',
            output: { answer: 42 },
            content: [{ type: 'text', text: 'Done' }],
          },
          error: { type: 'ToolError', message: 'Tool failed', code: 'tool_failed' },
        }),
      ).toBe(true)
    }
    expect(valid(schema, { ...run, revision: 1 })).toBe(false)
    expect(valid(schema, { ...run, state: 'pending' })).toBe(false)
  })

  test('run and inbox parameters use runtime field names', () => {
    for (const name of ['runs.get', 'runs.cancel', 'runs.trace'] as const) {
      expect(valid(hostProtocol.protocol[name].param, { runID })).toBe(true)
      expect(valid(hostProtocol.protocol[name].param, { id: runID })).toBe(false)
    }
    for (const name of [
      'inbox.get',
      'inbox.answer',
      'inbox.decline',
      'inbox.cancel',
      'inbox.prompt',
    ] as const) {
      expect(valid(hostProtocol.protocol[name].param, { id: input.id })).toBe(true)
      expect(valid(hostProtocol.protocol[name].param, { runID })).toBe(false)
    }
    expect(
      valid(hostProtocol.protocol['runs.list'].param, {
        states: ['working'],
        limit: 5,
        updatedBefore: meta.time,
      }),
    ).toBe(true)
    expect(valid(hostProtocol.protocol['runs.list'].param, { limit: 0 })).toBe(true)
    expect(valid(hostProtocol.protocol['runs.list'].param, { states: ['invalid'] })).toBe(false)
    expect(valid(hostProtocol.protocol['inbox.list'].param, { runID })).toBe(true)
    expect(
      valid(hostProtocol.protocol['inbox.answer'].param, {
        id: input.id,
        content: { name: 'Alice' },
      }),
    ).toBe(true)
    expect(
      valid(hostProtocol.protocol['inbox.decline'].param, { id: input.id, reason: 'Skip' }),
    ).toBe(true)
  })

  test('inbox acknowledgements and prompt results expose settlement actions', () => {
    for (const name of ['inbox.answer', 'inbox.decline', 'inbox.cancel'] as const) {
      expect(valid(hostProtocol.protocol[name].result, { settled: true })).toBe(true)
      expect(valid(hostProtocol.protocol[name].result, { settled: false })).toBe(false)
    }
    for (const action of ['accept', 'decline', 'cancel'])
      expect(valid(hostProtocol.protocol['inbox.prompt'].result, { action })).toBe(true)
    expect(valid(hostProtocol.protocol['inbox.prompt'].result, { action: 'answered' })).toBe(false)
    expect(valid(hostProtocol.protocol['inbox.get'].result, input)).toBe(true)
    expect(valid(hostProtocol.protocol['inbox.list'].result, [approval, input])).toBe(true)
  })

  test('flow summaries retain extensible input schemas', () => {
    expect(
      valid(hostProtocol.protocol['flows.list'].result, [
        {
          id: 'empty',
          name: 'Empty',
          version: 1,
          input: { type: 'object', properties: { name: { type: 'string', 'x-display': 'name' } } },
          outputs: ['answer'],
          outcomes: ['done'],
        },
      ]),
    ).toBe(true)
  })

  test('trace results preserve stored spans and logs', () => {
    const traceID = '12345678901234567890123456789012'
    const spanID = '1234567890123456'
    const trace = {
      spans: [
        {
          traceID,
          spanID,
          parentSpanID: '2345678901234567',
          name: 'run',
          kind: 1,
          startTime: meta.time,
          endTime: meta.time + 1,
          status: { code: 1 },
          attributes: { values: [true, null] },
          events: [{ name: 'input', time: meta.time, attributes: { count: 1 } }],
          links: [{ traceID, spanID }],
        },
      ],
      logs: [
        {
          traceID,
          spanID,
          timestamp: meta.time,
          level: 'warning',
          category: ['mokei', 'flow'],
          message: 'Waiting',
          properties: { nested: { enabled: true } },
        },
      ],
    }
    const schema = hostProtocol.protocol['runs.trace'].result
    expect(valid(schema, trace)).toBe(true)
    expect(valid(schema, { spans: [], logs: [] })).toBe(true)
    expect(valid(schema, { ...trace, logs: [{ ...trace.logs[0], level: 'warn' }] })).toBe(false)
    expect(
      valid(schema, { ...trace, spans: [{ ...trace.spans[0], attributes: { fn: () => {} } }] }),
    ).toBe(false)
  })
})

import { createClientMessageSchema, createServerMessageSchema } from '@enkaku/protocol'
