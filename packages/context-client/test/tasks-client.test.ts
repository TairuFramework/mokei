import { DirectTransports } from '@enkaku/transport'
import type {
  CallToolResult,
  ClientMessage,
  ClientRequest,
  CreateTaskResult,
  InputRequiredResult,
  ServerMessage,
} from '@mokei/context-protocol'
import { METHOD_NOT_FOUND, TASKS_EXTENSION } from '@mokei/context-protocol'
import { afterEach, expect, expectTypeOf, test } from 'vitest'

import {
  ContextClient,
  StructuredContentValidationError,
  TaskInputUnavailableError,
} from '../src/index.js'

const created = {
  resultType: 'task' as const,
  taskId: 'task-1',
  status: 'working' as const,
  createdAt: '2026-09-29T12:00:00.000Z',
  lastUpdatedAt: '2026-09-29T12:00:00.000Z',
  ttlMs: 1000,
}
const finalResult = {
  resultType: 'complete' as const,
  content: [{ type: 'text' as const, text: 'done' }],
}
const complete = { ...created, resultType: 'complete', status: 'completed', result: finalResult }
const discovery = {
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  capabilities: { tools: {} },
  ttlMs: 0,
  cacheScope: 'private',
}

type Reply = (request: ClientRequest) => unknown
const transports: Array<DirectTransports<ServerMessage, ClientMessage>> = []

function harness(
  reply: Reply,
  version: '2025-11-25' | '2026-07-28' = '2026-07-28',
  withRoots = false,
) {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  transports.push(pair)
  const client = new ContextClient({
    protocolVersion: version,
    transport: pair.client,
    listRoots: withRoots ? [] : undefined,
  })
  const sent: Array<ClientRequest> = []
  void (async () => {
    for (;;) {
      const next = await pair.server.read()
      if (next.done) return
      const request = next.value as ClientRequest
      sent.push(request)
      if (request.id == null) continue
      if (request.method === 'subscriptions/listen') {
        pair.server.write({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: METHOD_NOT_FOUND, message: 'unavailable' },
        } as ServerMessage)
        continue
      }
      const result =
        request.method === 'initialize'
          ? {
              protocolVersion: version,
              capabilities: {},
              serverInfo: { name: 'test', version: '1' },
            }
          : request.method === 'server/discover'
            ? discovery
            : reply(request)
      pair.server.write({ jsonrpc: '2.0', id: request.id, result } as ServerMessage)
    }
  })()
  return { client, sent }
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map((pair) => pair.dispose()))
})

test('declares tasks only on current revision, including setup discovery', async () => {
  const current = harness(() => finalResult)
  await current.client.callTool({ name: 'echo', arguments: {} })
  for (const request of current.sent.filter((item) => item.method !== 'subscriptions/listen')) {
    expect(request.params?._meta?.['io.modelcontextprotocol/clientCapabilities']).toMatchObject({
      extensions: { [TASKS_EXTENSION]: {} },
    })
  }

  const previous = harness(() => ({ content: finalResult.content }), '2025-11-25')
  await previous.client.callTool({ name: 'echo', arguments: {} })
  expect(
    previous.sent.find((item) => item.method === 'initialize')?.params?.capabilities,
  ).not.toHaveProperty('extensions')
  expect(
    previous.sent.find((item) => item.method === 'tools/call')?.params?._meta?.[
      'io.modelcontextprotocol/clientCapabilities'
    ],
  ).toBeUndefined()
})

test('exposes a stable handle and strips task from tool params', async () => {
  const { client, sent } = harness((request) => {
    if (request.method === 'tools/call') return created
    if (request.method === 'tasks/get') return complete
    return { resultType: 'complete' }
  })
  expect(client.tasks).toBe(client.tasks)
  const result = await client.callTool({ name: 'echo', arguments: {}, task: 'handle' })
  expectTypeOf(result).toEqualTypeOf<CallToolResult | CreateTaskResult>()
  expect(result).toEqual(created)
  expect(sent.find((item) => item.method === 'tools/call')?.params).not.toHaveProperty('task')
  expect(await client.tasks.get(created.taskId)).toEqual(complete)
  expect(await client.tasks.update(created.taskId, {})).toEqual({ resultType: 'complete' })
  expect(await client.tasks.cancel(created.taskId)).toEqual({ resultType: 'complete' })
  expect(
    sent.filter((item) => item.method.startsWith('tasks/')).map((item) => item.params?.taskId),
  ).toEqual([created.taskId, created.taskId, created.taskId])
  for (const request of sent.filter((item) => item.method.startsWith('tasks/'))) {
    expect(request.params?._meta?.['io.modelcontextprotocol/clientCapabilities']).toMatchObject({
      extensions: { [TASKS_EXTENSION]: {} },
    })
  }
})

test('default tool call waits for the final result', async () => {
  const { client } = harness((request) => (request.method === 'tools/call' ? created : complete))
  const result = await client.callTool({ name: 'echo', arguments: {} })
  expectTypeOf(result).toEqualTypeOf<CallToolResult>()
  expect(result).toEqual(finalResult)
})

test('fulfils an MRTR request before waiting for the created task', async () => {
  let calls = 0
  const { client, sent } = harness(
    (request) => {
      if (request.method === 'tools/call') {
        calls += 1
        return calls === 1
          ? {
              resultType: 'input_required',
              inputRequests: { ask: { method: 'roots/list', params: {} } },
            }
          : created
      }
      return complete
    },
    '2026-07-28',
    true,
  )
  expect(await client.callTool({ name: 'echo', arguments: {} })).toEqual(finalResult)
  expect(sent.filter((item) => item.method === 'tools/call')).toHaveLength(2)
  expect(sent.find((item) => item.method === 'tasks/get')).toBeDefined()
})

test('returns an opted-in input suspension before task handling', async () => {
  const suspension = {
    resultType: 'input_required',
    inputRequests: { ask: { method: 'roots/list', params: {} } },
  }
  const { client, sent } = harness(() => suspension)
  expect(
    await client.callTool({
      name: 'echo',
      arguments: {},
      task: 'handle',
      allowInputRequired: true,
    }),
  ).toEqual(suspension)
  expect(sent.some((item) => item.method === 'tasks/get')).toBe(false)
})

test('all callTool option combinations have their declared result types', () => {
  const withInput = (client: ContextClient) =>
    client.callTool({ name: 'echo', arguments: {}, allowInputRequired: true })
  const withBoth = (client: ContextClient) =>
    client.callTool({ name: 'echo', arguments: {}, task: 'handle', allowInputRequired: true })
  const withDynamic = (client: ContextClient, dynamic: boolean) =>
    client.callTool({ name: 'echo', arguments: {}, task: 'handle', allowInputRequired: dynamic })
  expectTypeOf<ReturnType<typeof withInput>>().toEqualTypeOf<
    Promise<CallToolResult | InputRequiredResult>
  >()
  expectTypeOf<ReturnType<typeof withBoth>>().toEqualTypeOf<
    Promise<CallToolResult | CreateTaskResult | InputRequiredResult>
  >()
  expectTypeOf<ReturnType<typeof withDynamic>>().toEqualTypeOf<
    Promise<CallToolResult | CreateTaskResult | InputRequiredResult>
  >()
})

test('automatic wait cancels on abort while explicit wait leaves the task running', async () => {
  const controller = new AbortController()
  const reason = new Error('stopped')
  const { client, sent } = harness((request) => {
    if (request.method === 'tools/call') return created
    if (request.method === 'tasks/get') {
      controller.abort(reason)
      return created
    }
    return { resultType: 'complete' }
  })
  await expect(
    client.callTool({ name: 'echo', arguments: {}, signal: controller.signal }),
  ).rejects.toBe(reason)
  expect(sent.some((item) => item.method === 'tasks/cancel')).toBe(true)

  const explicit = new AbortController()
  const other = harness((request) => {
    if (request.method === 'tasks/get') {
      explicit.abort(reason)
      return created
    }
    return { resultType: 'complete' }
  })
  await expect(other.client.tasks.wait(created.taskId, { signal: explicit.signal })).rejects.toBe(
    reason,
  )
  expect(other.sent.some((item) => item.method === 'tasks/cancel')).toBe(false)
})

test('automatic wait cancels when task input has no handler', async () => {
  const { client, sent } = harness((request) => {
    if (request.method === 'tools/call') return created
    if (request.method === 'tasks/get') {
      return {
        ...created,
        resultType: 'complete',
        status: 'input_required',
        inputRequests: { ask: { method: 'roots/list', params: {} } },
      }
    }
    return { resultType: 'complete' }
  })
  await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toBeInstanceOf(
    TaskInputUnavailableError,
  )
  expect(sent.some((item) => item.method === 'tasks/cancel')).toBe(true)
})

test('validates cached output on automatic and named explicit waits only', async () => {
  const invalid = { ...complete, result: { ...finalResult, structuredContent: { count: 'wrong' } } }
  const { client } = harness((request) => {
    if (request.method === 'tools/list') {
      return {
        resultType: 'complete',
        tools: [
          {
            name: 'echo',
            inputSchema: { type: 'object' },
            outputSchema: {
              type: 'object',
              properties: { count: { type: 'number' } },
              required: ['count'],
            },
          },
        ],
      }
    }
    return request.method === 'tools/call' ? created : invalid
  })
  expect(await client.tasks.wait(created.taskId)).toEqual(invalid.result)
  await client.listTools()
  await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toBeInstanceOf(
    StructuredContentValidationError,
  )
  await expect(client.tasks.wait(created.taskId, { toolName: 'echo' })).rejects.toBeInstanceOf(
    StructuredContentValidationError,
  )
  expect(await client.tasks.wait(created.taskId)).toEqual(invalid.result)
})

test('returns task output without a cached schema', async () => {
  const invalid = { ...complete, result: { ...finalResult, structuredContent: { count: 'wrong' } } }
  const { client } = harness((request) => (request.method === 'tools/call' ? created : invalid))
  expect(await client.callTool({ name: 'echo', arguments: {} })).toEqual(invalid.result)
})
