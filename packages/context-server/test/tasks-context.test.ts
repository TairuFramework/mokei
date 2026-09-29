import { DirectTransports } from '@enkaku/transport'
import type {
  CallToolResult,
  ClientMessage,
  ClientRequest,
  ServerMessage,
} from '@mokei/context-protocol'
import { TASKS_EXTENSION } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { describe, expect, test, vi } from 'vitest'

import { ContextServer, createPrompt, createTaskManager, createTool } from '../src/index.js'

const currentMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': { extensions: { [TASKS_EXTENSION]: {} } },
  caller: 'abc',
}

async function exchange(
  transports: DirectTransports<ServerMessage, ClientMessage>,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  transports.client.write({ jsonrpc: '2.0', id: 1, method, params } as ClientRequest)
  const response = await transports.client.read()
  expect(response.done).toBe(false)
  return response.value as Record<string, unknown>
}

function setup(params: {
  tasks?: ReturnType<typeof createTaskManager>
  tools?: Record<string, ReturnType<typeof createTool>>
  prompts?: Record<string, ReturnType<typeof createPrompt>>
  protocolVersions?: Array<'2025-11-25' | '2026-07-28'>
}) {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'test',
    version: '1.0.0',
    protocolVersions: params.protocolVersions ?? ['2026-07-28'],
    transport: transports.server,
    tasks: params.tasks,
    tools: params.tools,
    prompts: params.prompts,
    cache: { ttlMs: 1000, cacheScope: 'public' },
  })
  return { server, transports }
}

describe('tool task context', () => {
  test('requires a manager, current revision and declared client capability', async () => {
    for (const [tasks, meta, version, expected] of [
      [undefined, currentMeta, '2026-07-28', false],
      [
        createTaskManager(),
        { ...currentMeta, 'io.modelcontextprotocol/clientCapabilities': {} },
        '2026-07-28',
        false,
      ],
      [createTaskManager(), undefined, '2025-11-25', false],
      [createTaskManager(), currentMeta, '2026-07-28', true],
    ] as const) {
      const tool = createTool({
        description: 'probe',
        inputSchema: { type: 'object' },
        handler: (request) => ({
          content: [{ type: 'text', text: String(request.task != null) }],
          structuredContent: {
            received: request.meta,
            hasTask: Object.hasOwn(request, 'task'),
          },
        }),
      })
      const { server, transports } = setup({
        tasks,
        tools: { probe: tool },
        protocolVersions: [version],
      })
      const response = await exchange(transports, 'tools/call', {
        name: 'probe',
        arguments: {},
        ...(meta === undefined ? {} : { _meta: meta }),
      })
      expect(response.result).toMatchObject({
        content: [{ text: String(expected) }],
        structuredContent: { received: meta ?? {}, hasTask: expected },
      })
      await server.dispose()
      await tasks?.dispose()
      await transports.dispose()
    }
  })

  test('advertises tasks only with a manager', async () => {
    for (const enabled of [false, true]) {
      const tasks = enabled ? createTaskManager() : undefined
      const { server, transports } = setup({ tasks })
      const response = await exchange(transports, 'server/discover', { _meta: currentMeta })
      const capabilities = (
        response.result as { capabilities: { extensions?: Record<string, unknown> } }
      ).capabilities
      expect(capabilities.extensions?.[TASKS_EXTENSION]).toEqual(enabled ? {} : undefined)
      await server.dispose()
      await tasks?.dispose()
      await transports.dispose()
    }
  })

  test('does not expose task context to a prompt handler', async () => {
    const tasks = createTaskManager()
    const prompt = createPrompt({
      description: 'probe',
      handler: ({ task, meta }) => ({
        messages: [{ role: 'assistant', content: { type: 'text', text: String(task == null) } }],
        _meta: { caller: meta.caller },
      }),
    })
    const { server, transports } = setup({ tasks, prompts: { probe: prompt } })
    const response = await exchange(transports, 'prompts/get', {
      name: 'probe',
      _meta: currentMeta,
    })
    expect(response.result).toMatchObject({
      messages: [{ content: { text: 'true' } }],
      _meta: { caller: 'abc' },
    })
    await server.dispose()
    await tasks.dispose()
    await transports.dispose()
  })

  test('rejects a task result when no task context was supplied', async () => {
    const tool = createTool({
      description: 'invalid task',
      inputSchema: { type: 'object' },
      handler: () => ({
        taskId: crypto.randomUUID(),
        status: 'working',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        ttlMs: 1000,
        resultType: 'task',
      }),
    })
    const { server, transports } = setup({ tools: { invalid: tool } })
    const response = await exchange(transports, 'tools/call', {
      name: 'invalid',
      arguments: {},
      _meta: currentMeta,
    })
    expect(response.error).toMatchObject({ code: -32603 })
    await server.dispose()
    await transports.dispose()
  })

  test('passes request metadata into detached work and settles its result', async () => {
    const tasks = createTaskManager()
    let workerSignal: AbortSignal | undefined
    let requestSignal: AbortSignal | undefined
    const tool = createTool({
      description: 'task',
      inputSchema: { type: 'object' },
      handler: ({ task, meta, signal }) => {
        requestSignal = signal
        if (task == null) throw new Error('Expected task context')
        return task.run(async (handle) => {
          workerSignal = handle.signal
          return {
            content: [{ type: 'text', text: String(handle.requestMeta.caller) }],
            structuredContent: { meta },
          }
        })
      },
    })
    const { server, transports } = setup({ tasks, tools: { task: tool } })
    const response = await exchange(transports, 'tools/call', {
      name: 'task',
      arguments: {},
      _meta: currentMeta,
    })
    const created = response.result as { taskId: string; resultType: string; ttlMs?: number }
    expect(created.resultType).toBe('task')
    expect(created.ttlMs).toBeDefined()
    expect(created).not.toHaveProperty('cacheScope')
    expect(workerSignal).not.toBe(requestSignal)
    await vi.waitFor(async () => {
      expect(await tasks.get(created.taskId)).toMatchObject({
        status: 'completed',
        result: {
          resultType: 'complete',
          content: [{ text: 'abc' }],
          structuredContent: { meta: currentMeta },
        },
      })
    })
    await server.dispose()
    await tasks.dispose()
    await transports.dispose()
  })

  test.each([
    [
      'normal',
      () => ({ content: [{ type: 'text' as const, text: 'ok' }], structuredContent: { value: 1 } }),
    ],
    ['bad output', () => ({ content: [], structuredContent: { value: 'bad' } })],
    [
      'tool error',
      () => {
        throw new Error('tool failed')
      },
    ],
    [
      'RPC error',
      () => {
        throw new RPCError({ code: -32042, message: 'protocol failed', data: { reason: 'test' } })
      },
    ],
  ])('settles %s through the same inline and detached seam', async (label, work) => {
    const tasks = createTaskManager()
    const tool = createTool({
      description: label,
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      },
      handler: ({ task }) => {
        const run = () =>
          work() as unknown as CallToolResult & { structuredContent: { value: number } }
        return task == null ? run() : task.run(async () => run())
      },
    })
    const inlineMeta = { ...currentMeta, 'io.modelcontextprotocol/clientCapabilities': {} }
    const { server, transports } = setup({ tasks, tools: { tool } })
    const inline = await exchange(transports, 'tools/call', {
      name: 'tool',
      arguments: {},
      _meta: inlineMeta,
    })
    const detached = await exchange(transports, 'tools/call', {
      name: 'tool',
      arguments: {},
      _meta: currentMeta,
    })
    const taskID = (detached.result as { taskId: string }).taskId
    await vi.waitFor(async () => {
      expect((await tasks.get(taskID)).status).not.toBe('working')
    })
    const final = await tasks.get(taskID)
    if (label === 'bad output' || label === 'RPC error') {
      expect(inline.error).toMatchObject(final.error as Record<string, unknown>)
      expect(final.status).toBe('failed')
    } else {
      expect(inline.result).toMatchObject(final.result as Record<string, unknown>)
      expect(final.status).toBe('completed')
      expect(final.result).toMatchObject({ resultType: 'complete' })
    }
    await server.dispose()
    await tasks.dispose()
    await transports.dispose()
  })
})
