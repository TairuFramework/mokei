import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, type GenericToolDefinition } from '@mokei/context-server'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  FlowControlError,
  type FlowRunSnapshot,
  type InboxItem,
  type PromptAction,
  type RunState,
} from '../src/index.js'
import { createFlowControlServer } from '../src/server.js'
import { createMemoryControl, type MemoryControlOptions } from './memory-control.js'

function snapshot(state: RunState, extra: Partial<FlowRunSnapshot> = {}): FlowRunSnapshot {
  return {
    runID: 'run-1',
    label: 'test',
    state,
    createdAt: 1,
    updatedAt: 1,
    plan: { tools: [] },
    ...extra,
  }
}

function inputItem(id: string): InboxItem {
  return {
    id,
    runID: 'run-1',
    kind: 'input',
    inputKey: 'name',
    message: 'Your name?',
    requestedSchema: { type: 'object' },
    createdAt: 1,
  }
}

function approvalItem(id: string): InboxItem {
  return { id, runID: 'run-1', kind: 'approval', plan: { tools: ['t'] }, createdAt: 1 }
}

// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON-RPC results in tests
type Json = any

type ToolResult = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent?: Json
}

function setup(options: MemoryControlOptions = {}) {
  const memory = createMemoryControl(options)
  const config = createFlowControlServer(memory.control)
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({ ...config, transport: transports.server })
  let nextID = 1

  async function request(method: string, params?: Record<string, unknown>) {
    const id = nextID++
    transports.client.write({ jsonrpc: '2.0', id, method, params } as ClientRequest)
    const res = await transports.client.read()
    return res.value as { id: number; result?: Json; error?: Json }
  }

  async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const res = await request('tools/call', { name, arguments: args })
    if (res.error != null) throw new Error(`RPC error: ${JSON.stringify(res.error)}`)
    return res.result as ToolResult
  }

  /** Calls the handler directly, to control the request signal. */
  function callDirect(name: string, input: Record<string, unknown>, signal?: AbortSignal) {
    const tool = (config.tools as Record<string, GenericToolDefinition>)[name]
    if (tool == null) throw new Error(`Unknown tool ${name}`)
    return tool.handler({
      input,
      signal: signal ?? new AbortController().signal,
    } as never) as Promise<ToolResult>
  }

  return {
    memory,
    config,
    request,
    call,
    callDirect,
    dispose: async () => {
      await server.dispose()
      await transports.dispose()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createFlowControlServer', () => {
  test('config names and protocol versions', async () => {
    const { config } = setup()
    expect(config.name).toBe('mokei-flows')
    expect(config.protocolVersions).toEqual(['2026-07-28', '2025-11-25'])
    const custom = createFlowControlServer(createMemoryControl().control, {
      name: 'x',
      version: '9.9.9',
    })
    expect(custom.name).toBe('x')
    expect(custom.version).toBe('9.9.9')
  })

  test('registers prompt_input only when prompt exists', async () => {
    const without = setup()
    const list = await without.request('tools/list')
    const names = list.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'list_flows',
        'check_flow',
        'start_flow',
        'flow_status',
        'wait_flow',
        'list_runs',
        'cancel_flow',
        'answer_input',
        'decline_input',
      ]),
    )
    expect(names).not.toContain('prompt_input')
    await without.dispose()

    const withPrompt = setup({ prompt: async () => 'accept' })
    const list2 = await withPrompt.request('tools/list')
    expect(list2.result.tools.map((tool: { name: string }) => tool.name)).toContain('prompt_input')
    await withPrompt.dispose()
  })

  test('list_flows and check_flow', async () => {
    const t = setup({
      flows: [{ name: 'a', description: 'A flow' } as never],
      check: () => ({ value: {}, warnings: [], formatted: 'Looks good' }),
    })
    const flows = await t.call('list_flows')
    expect(flows.isError).toBeFalsy()
    expect(JSON.parse(flows.content[0]?.text ?? '')).toEqual([{ name: 'a', description: 'A flow' }])
    const check = await t.call('check_flow', { definition: {} })
    expect(check.content[0]?.text).toBe('Looks good')
    await t.dispose()
  })

  test('start_flow requires exactly one of flow and definition', async () => {
    const t = setup()
    const neither = await t.call('start_flow', {})
    expect(neither.isError).toBe(true)
    const both = await t.call('start_flow', { flow: 'a', definition: {} })
    expect(both.isError).toBe(true)
    expect(both.content[0]?.text).toMatch(/exactly one/i)
    await t.dispose()
  })

  test('start_flow defaults input to {} and returns the status', async () => {
    const t = setup()
    const start = vi.spyOn(t.memory.control.runs, 'start')
    const result = await t.call('start_flow', { flow: 'a', label: 'L' })
    expect(result.isError).toBeFalsy()
    expect(start).toHaveBeenCalledWith({ flow: 'a', input: {}, label: 'L' })
    expect(result.structuredContent).toMatchObject({
      runID: 'run-1',
      state: 'working',
      pending: [],
    })
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent)
    await t.dispose()
  })

  test('start_flow accepts a definition', async () => {
    const t = setup()
    const start = vi.spyOn(t.memory.control.runs, 'start')
    await t.call('start_flow', { definition: { a: 1 }, input: { x: 1 } })
    expect(start).toHaveBeenCalledWith({ definition: { a: 1 }, input: { x: 1 } })
    await t.dispose()
  })

  test('flow_status reports canPrompt', async () => {
    for (const canPrompt of [false, true]) {
      const t = setup(canPrompt ? { prompt: async () => 'accept' } : {})
      t.memory.setRun(snapshot('input_required'))
      t.memory.addItem(inputItem('i-1'))
      const result = await t.call('flow_status', { runID: 'run-1' })
      expect(result.structuredContent?.pending).toEqual([
        {
          id: 'i-1',
          kind: 'input',
          message: 'Your name?',
          requestedSchema: { type: 'object' },
          canPrompt,
        },
      ])
      await t.dispose()
    }
  })

  test('unknown run returns an error naming the code, never throws', async () => {
    const t = setup()
    for (const [name, args] of [
      ['flow_status', { runID: 'nope' }],
      ['wait_flow', { runID: 'nope' }],
      ['cancel_flow', { runID: 'nope' }],
    ] as const) {
      const result = await t.call(name, args)
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('RUN_NOT_FOUND')
      expect(result.structuredContent?.code).toBe('RUN_NOT_FOUND')
    }
    await t.dispose()
  })

  test('unexpected errors become INTERNAL_ERROR results', async () => {
    const t = setup()
    t.memory.control.flows.list = async () => {
      throw new Error('boom')
    }
    const result = await t.call('list_flows')
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('INTERNAL_ERROR')
    expect(result.content[0]?.text).toContain('boom')
    await t.dispose()
  })

  test('wait_flow returns at once when actionable', async () => {
    const t = setup()
    t.memory.setRun(snapshot('input_required'))
    t.memory.addItem(inputItem('i-1'))
    const result = await t.call('wait_flow', { runID: 'run-1', timeoutMs: 1000 })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ runID: 'run-1', timedOut: false })
    expect(result.structuredContent?.pending).toHaveLength(1)
    await t.dispose()
  })

  test('wait_flow clamps timeoutMs to 300000 and defaults to 60000', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.memory.setRun(snapshot('working'))

    let settled = false
    const clamped = t.callDirect('wait_flow', { runID: 'run-1', timeoutMs: 999999 }).then((r) => {
      settled = true
      return r
    })
    await vi.advanceTimersByTimeAsync(299_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await clamped).structuredContent?.timedOut).toBe(true)

    settled = false
    const defaulted = t.callDirect('wait_flow', { runID: 'run-1' }).then((r) => {
      settled = true
      return r
    })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await defaulted).structuredContent?.timedOut).toBe(true)
  })

  test('wait_flow cancellation returns an error result', async () => {
    const t = setup()
    t.memory.setRun(snapshot('working'))
    const controller = new AbortController()
    const pending = t.callDirect('wait_flow', { runID: 'run-1' }, controller.signal)
    controller.abort(new Error('cancelled by client'))
    const result = await pending
    expect(result.isError).toBe(true)
    await t.dispose()
  })

  test('list_runs omits pending and defaults the limit to 20', async () => {
    const t = setup()
    t.memory.setRun(snapshot('input_required'))
    t.memory.setRun(snapshot('completed', { runID: 'run-2', result: { content: [] } }))
    const list = vi.spyOn(t.memory.control.runs, 'list')
    const result = await t.call('list_runs', {})
    expect(list).toHaveBeenCalledWith({ limit: 20 })
    expect(result.structuredContent?.runs).toEqual([
      { runID: 'run-1', state: 'input_required' },
      { runID: 'run-2', state: 'completed', result: { content: [] } },
    ])
    await t.call('list_runs', { states: ['completed'], limit: 5 })
    expect(list).toHaveBeenLastCalledWith({ states: ['completed'], limit: 5 })
    await t.dispose()
  })

  test('cancel_flow returns the status', async () => {
    const t = setup()
    t.memory.setRun(snapshot('working'))
    const result = await t.call('cancel_flow', { runID: 'run-1' })
    expect(result.structuredContent).toMatchObject({ runID: 'run-1', state: 'cancelled' })
    await t.dispose()
  })

  test('answer_input and decline_input settle input items', async () => {
    const t = setup()
    t.memory.setRun(snapshot('input_required'))
    t.memory.addItem(inputItem('i-1'))
    t.memory.addItem(inputItem('i-2'))
    const answer = vi.spyOn(t.memory.control.inbox, 'answer')
    const decline = vi.spyOn(t.memory.control.inbox, 'decline')
    const a = await t.call('answer_input', { id: 'i-1', value: { name: 'x' } })
    expect(a.isError).toBeFalsy()
    expect(answer).toHaveBeenCalledWith('i-1', { name: 'x' })
    const d = await t.call('decline_input', { id: 'i-2', reason: 'no' })
    expect(d.isError).toBeFalsy()
    expect(decline).toHaveBeenCalledWith('i-2', 'no')
    expect(d.structuredContent?.pending).toEqual([])
    await t.dispose()
  })

  test('answer_input and decline_input refuse approval items', async () => {
    const t = setup({ prompt: async () => 'accept' })
    t.memory.setRun(snapshot('awaiting_approval'))
    t.memory.addItem(approvalItem('a-1'))
    const answer = await t.call('answer_input', { id: 'a-1', value: {} })
    expect(answer.isError).toBe(true)
    expect(answer.content[0]?.text).toContain('prompt_input')
    const decline = await t.call('decline_input', { id: 'a-1' })
    expect(decline.isError).toBe(true)
    expect(decline.content[0]?.text).toContain('prompt_input')
    const status = await t.call('flow_status', { runID: 'run-1' })
    expect(status.structuredContent?.pending.map((item: { id: string }) => item.id)).toEqual([
      'a-1',
    ])
    await t.dispose()
  })

  test('answer_input on an unknown item reports INBOX_ITEM_NOT_FOUND', async () => {
    const t = setup()
    const result = await t.call('answer_input', { id: 'x', value: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('INBOX_ITEM_NOT_FOUND')
    await t.dispose()
  })

  describe('prompt_input', () => {
    test('returns the id and action', async () => {
      const prompt = vi.fn(async (_id: string): Promise<PromptAction> => 'decline')
      const t = setup({ prompt })
      t.memory.setRun(snapshot('input_required'))
      t.memory.addItem(inputItem('i-1'))
      const result = await t.call('prompt_input', { id: 'i-1' })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ id: 'i-1', action: 'decline' })
      expect(prompt.mock.calls[0]?.[0]).toBe('i-1')
      await t.dispose()
    })

    test('PROMPT_IN_PROGRESS names the item', async () => {
      const t = setup({
        prompt: async () => {
          throw new FlowControlError({ code: 'PROMPT_IN_PROGRESS', message: 'busy' })
        },
      })
      t.memory.setRun(snapshot('input_required'))
      t.memory.addItem(inputItem('i-1'))
      const result = await t.call('prompt_input', { id: 'i-1' })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('i-1')
      expect(result.content[0]?.text).toContain('PROMPT_IN_PROGRESS')
      await t.dispose()
    })

    test('PROMPT_UNSUPPORTED names the item', async () => {
      const t = setup({
        prompt: async () => {
          throw new FlowControlError({ code: 'PROMPT_UNSUPPORTED', message: 'no render' })
        },
      })
      t.memory.setRun(snapshot('input_required'))
      t.memory.addItem(inputItem('i-1'))
      const result = await t.call('prompt_input', { id: 'i-1' })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('i-1')
      expect(result.content[0]?.text).toContain('PROMPT_UNSUPPORTED')
      await t.dispose()
    })

    test('INBOX_ITEM_NOT_FOUND after the dialog opened says the item was settled elsewhere', async () => {
      const t = setup({
        prompt: async () => {
          throw new FlowControlError({ code: 'INBOX_ITEM_NOT_FOUND', message: 'gone' })
        },
      })
      t.memory.setRun(snapshot('input_required'))
      t.memory.addItem(inputItem('i-1'))
      const result = await t.call('prompt_input', { id: 'i-1' })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/settled elsewhere/i)
      expect(result.content[0]?.text).toContain('i-1')
      await t.dispose()
    })

    test('an unknown id is a real not-found and never opens the dialog', async () => {
      const prompt = vi.fn(async (_id: string): Promise<PromptAction> => 'accept')
      const t = setup({ prompt })
      const result = await t.call('prompt_input', { id: 'missing' })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('INBOX_ITEM_NOT_FOUND')
      expect(result.content[0]?.text).not.toMatch(/settled elsewhere/i)
      expect(prompt).not.toHaveBeenCalled()
      await t.dispose()
    })

    test('passes the request signal and reports cancellation', async () => {
      let received: AbortSignal | undefined
      const t = setup({
        prompt: (_id, signal) => {
          received = signal
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
      })
      t.memory.setRun(snapshot('input_required'))
      t.memory.addItem(inputItem('i-1'))
      const controller = new AbortController()
      const pending = t.callDirect('prompt_input', { id: 'i-1' }, controller.signal)
      await vi.waitFor(() => expect(received).toBe(controller.signal))
      controller.abort(new Error('stop'))
      const result = await pending
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/pending/i)
      await t.dispose()
    })
  })
})
