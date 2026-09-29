import type { CallToolResult } from '@mokei/context-protocol'
import { ContextHost } from '@mokei/host'
import { createSystemOneConfig, predictOutputSchema } from '@mokei/mcp-system-one'
import { SystemOneClient, SystemOneError, SystemOneResponseError } from '@mokei/system-one-client'
import { afterEach, expect, test, vi } from 'vitest'

import { createMCPPredictor, resolvePredictor } from '../src/predictor.js'
import { hostToolCaller, type ToolCaller } from '../src/tool-caller.js'

const hosts: Array<ContextHost> = []
const questions = { flag: { type: 'noul' as const, instructions: 'Is this urgent?' } }
const prediction = {
  model: 'test-model',
  answers: { flag: { type: 'noul' as const, noul: 0.7 } },
  usage: { inputTokens: 3, outputTokens: 2 },
}
const result: CallToolResult = { content: [], structuredContent: prediction }

function params(signal = new AbortController().signal) {
  return {
    state: 'Help me',
    questions,
    signal,
    call: { runID: 'run-1', invocationID: 'node-2', attempt: 3 },
  }
}

function caller(overrides: Partial<ToolCaller> = {}): ToolCaller {
  return {
    listTools: () => [
      {
        id: 'system-one:predict',
        inputSchema: { type: 'object' },
        outputSchema: predictOutputSchema,
      },
    ],
    callTool: async () => ({ result }),
    waitTask: async () => result,
    cancelTask: async () => {},
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

test('returns structured prediction from the bundled System One server', async () => {
  const host = new ContextHost()
  hosts.push(host)
  const client = new SystemOneClient({
    backend: {
      predict: async () => ({
        model: 'test-model',
        answers: { flag: { type: 'noul', noul: 0.7 } },
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    },
    defaultModel: 'test-model',
  })
  host.addDirectContext({
    key: 'system-one',
    protocolVersion: '2026-07-28',
    config: createSystemOneConfig({ client }),
  })
  await host.setup({ key: 'system-one' })

  const actualCaller = hostToolCaller(host)
  const predictor = createMCPPredictor({
    ...actualCaller,
    async callTool(call) {
      const outcome = await actualCaller.callTool(call)
      if ('task' in outcome) return outcome
      return { result: { ...outcome.result, content: [{ type: 'text', text: 'not prediction' }] } }
    },
  })({ depth: 1 })

  await expect(predictor.predict(params())).resolves.toMatchObject(prediction)
})

test('rejects an older text-only sibling result', async () => {
  const older = caller({
    listTools: () => [{ id: 'older:predict', inputSchema: { type: 'object' } }],
    callTool: async () => ({
      result: { content: [{ type: 'text', text: JSON.stringify(prediction) }] },
    }),
  })

  await expect(
    createMCPPredictor(older, { tool: 'older:predict' })({ depth: 0 }).predict(params()),
  ).rejects.toBeInstanceOf(SystemOneResponseError)
})

test('rejects structured content that fails the live output schema', async () => {
  const current = caller({
    callTool: async () => ({
      result: { content: [], structuredContent: { ...prediction, usage: {} } },
    }),
  })

  await expect(createMCPPredictor(current)({ depth: 0 }).predict(params())).rejects.toBeInstanceOf(
    SystemOneResponseError,
  )
})

test('maps isError to SystemOneError with sibling text', async () => {
  const failed = caller({
    callTool: async () => ({
      result: { content: [{ type: 'text', text: 'backend unavailable' }], isError: true },
    }),
  })

  await expect(createMCPPredictor(failed)({ depth: 0 }).predict(params())).rejects.toMatchObject({
    name: 'SystemOneError',
    message: 'backend unavailable',
  })
})

test('waits for a task handle and returns its structured result', async () => {
  const waitTask = vi.fn<ToolCaller['waitTask']>(async () => result)
  const taskCaller = caller({ callTool: async () => ({ task: { taskId: 'task-1' } }), waitTask })

  await expect(
    createMCPPredictor(taskCaller)({ depth: 0 }).predict(params()),
  ).resolves.toMatchObject(prediction)
  expect(waitTask).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'system-one:predict', taskId: 'task-1' }),
  )
})

test('maps a failed sibling task to SystemOneError', async () => {
  const taskCaller = caller({
    callTool: async () => ({ task: { taskId: 'task-1' } }),
    waitTask: async () => {
      throw new Error('task failed')
    },
  })

  await expect(
    createMCPPredictor(taskCaller)({ depth: 0 }).predict(params()),
  ).rejects.toBeInstanceOf(SystemOneError)
})

test('aborting a prediction cancels its sibling task', async () => {
  const controller = new AbortController()
  const cancelTask = vi.fn<ToolCaller['cancelTask']>(async () => {})
  const taskCaller = caller({
    callTool: async () => ({ task: { taskId: 'task-1' } }),
    waitTask: async ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    cancelTask,
  })
  const pending = createMCPPredictor(taskCaller)({ depth: 0 }).predict(params(controller.signal))
  await Promise.resolve()
  controller.abort()

  await expect(pending).rejects.toBeInstanceOf(SystemOneError)
  expect(cancelTask).toHaveBeenCalledWith({ id: 'system-one:predict', taskId: 'task-1' })
})

test('passes flow metadata and a predictor-specific operation key', async () => {
  const callTool = vi.fn<ToolCaller['callTool']>(async () => ({ result }))
  const factory = createMCPPredictor(caller({ callTool }))

  await resolvePredictor(factory, { depth: 2 }).predict(params())

  expect(factory.tool).toBe('system-one:predict')
  expect(callTool).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'system-one:predict',
      arguments: { state: 'Help me', questions },
      meta: {
        'io.mokei/flow-depth': 3,
        'io.mokei/idempotency-key': 'run-1:node-2:predict',
        'io.mokei/attempt': 3,
      },
    }),
  )
})

test('resolvePredictor preserves a direct predictor', () => {
  const direct = { predict: async () => prediction }
  expect(resolvePredictor(direct, { depth: 2 })).toBe(direct)
})
