import type { CallToolResult } from '@mokei/context-protocol'
import { createDecisionFlowGraph } from '@mokei/decision-flow'
import { ContextHost } from '@mokei/host'
import { createSystemOneConfig, predictOutputSchema } from '@mokei/mcp-system-one'
import {
  SYSTEM_ONE_ERROR_META,
  SystemOneClient,
  SystemOneError,
  SystemOneModelError,
  SystemOneRateLimitError,
  SystemOneResponseError,
} from '@mokei/system-one-client'
import type { FlowDefinition } from '@sozai/flow-graph'
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
        'dev.mokei/flow-depth': 3,
        'dev.mokei/idempotency-key': 'run-1:node-2:predict',
        'dev.mokei/attempt': 3,
      },
    }),
  )
})

test('resolvePredictor preserves a direct predictor', () => {
  const direct = { predict: async () => prediction }
  expect(resolvePredictor(direct, { depth: 2 })).toBe(direct)
})

const modelErrorResult: CallToolResult = {
  isError: true,
  content: [{ type: 'text', text: 'unknown model' }],
  _meta: { 'dev.mokei/system-one-error': { name: 'SystemOneModelError' } },
}

test('an error result with system-one meta rebuilds the typed error', async () => {
  const failed = caller({ callTool: async () => ({ result: modelErrorResult }) })
  const pending = createMCPPredictor(failed)({ depth: 0 }).predict(params())
  await expect(pending).rejects.toBeInstanceOf(SystemOneModelError)
  await expect(pending).rejects.toMatchObject({ message: 'unknown model' })
})

test('an error result without meta stays a plain SystemOneError', async () => {
  const failed = caller({
    callTool: async () => ({ result: { isError: true, content: modelErrorResult.content } }),
  })
  await expect(createMCPPredictor(failed)({ depth: 0 }).predict(params())).rejects.toMatchObject({
    name: 'SystemOneError',
    message: 'unknown model',
  })
})

test.each([null, 'SystemOneModelError', 42, [], {}, { name: 42 }, { name: 'UnknownError' }])(
  'falls back to a plain error for invalid or unknown metadata %j',
  async (info) => {
    const failed = caller({
      callTool: async () => ({
        result: { ...modelErrorResult, _meta: { [SYSTEM_ONE_ERROR_META]: info } },
      }),
    })
    await expect(createMCPPredictor(failed)({ depth: 0 }).predict(params())).rejects.toMatchObject({
      name: 'SystemOneError',
      message: 'unknown model',
    })
  },
)

test.each([
  { status: 429, retryAfterMs: 1500, expectedStatus: 429, expectedDelay: 1500 },
  { status: '429', retryAfterMs: '1500', expectedStatus: undefined, expectedDelay: undefined },
  { status: 429, retryAfterMs: null, expectedStatus: 429, expectedDelay: undefined },
  { status: false, retryAfterMs: 1500, expectedStatus: undefined, expectedDelay: 1500 },
])('preserves only numeric error details %j', async (details) => {
  const failed = caller({
    callTool: async () => ({
      result: {
        ...modelErrorResult,
        _meta: {
          [SYSTEM_ONE_ERROR_META]: {
            name: 'SystemOneRateLimitError',
            status: details.status,
            retryAfterMs: details.retryAfterMs,
          },
        },
      },
    }),
  })
  const pending = createMCPPredictor(failed)({ depth: 0 }).predict(params())
  await expect(pending).rejects.toBeInstanceOf(SystemOneRateLimitError)
  await expect(pending).rejects.toMatchObject({
    message: 'unknown model',
    status: details.expectedStatus,
    retryAfterMs: details.expectedDelay,
  })
})

test('a decide flow records the typed predictor failure', async () => {
  const flow: FlowDefinition = {
    id: 'typed-predictor-error',
    name: 'Typed predictor error',
    version: 1,
    start: 'decide',
    nodes: {
      decide: {
        kind: 'decide',
        state: { value: 'Help me' },
        questions,
        cases: [],
        default: 'done',
      },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  const failed = caller({ callTool: async () => ({ result: modelErrorResult }) })
  const graph = createDecisionFlowGraph({
    client: createMCPPredictor(failed)({ depth: 0 }),
    retryDefaults: { decide: { maxAttempts: 1 } },
  })
  const run = graph.start({ definition: flow })
  for await (const _state of run) {
  }
  expect(run.getState()).toMatchObject({
    status: 'error',
    error: { lastFailure: { type: 'SystemOneModelError' } },
  })
})
