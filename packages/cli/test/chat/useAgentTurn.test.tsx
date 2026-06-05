// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'vitest'

import { type AgentSessionLike, useAgentTurn } from '../../src/chat/hooks/useAgentTurn.js'

function mockAgent(events: Array<unknown>): AgentSessionLike {
  return {
    async *stream() {
      for (const e of events) {
        yield e as never
      }
    },
  }
}

async function renderHook<T>(fn: () => T): Promise<{ current: () => T; unmount: () => void }> {
  const container = document.createElement('div')
  const root = createRoot(container)
  let latest!: T
  function Probe() {
    latest = fn()
    return null
  }
  await act(async () => {
    root.render(<Probe />)
  })
  return {
    current: () => latest,
    unmount: () => root.unmount(),
  }
}

function throwingAgent(events: Array<unknown>, error: Error): AgentSessionLike {
  return {
    async *stream() {
      for (const e of events) {
        yield e as never
      }
      throw error
    },
  }
}

describe('useAgentTurn', () => {
  test('submit drives state through start -> text-delta -> complete', async () => {
    const agent = mockAgent([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'text-delta', text: 'Hello', timestamp: 1 },
      {
        type: 'complete',
        result: {
          text: 'Hello',
          messages: [{ source: 'client', role: 'user', text: 'hi' }],
          iterations: 1,
          toolCalls: [],
          inputTokens: 0,
          outputTokens: 0,
          duration: 0,
          finishReason: 'complete',
        },
        timestamp: 2,
      },
    ])

    const hook = await renderHook(() => useAgentTurn({ createAgent: () => agent }))

    await act(async () => {
      await hook.current().submit('hi')
    })

    const state = hook.current()
    expect(state.state).toBe('idle')
    expect(state.messages).toEqual([{ source: 'client', role: 'user', text: 'hi' }])
    hook.unmount()
  })

  test('submit swallows stream errors and resets abort controller', async () => {
    const agent = throwingAgent(
      [
        { type: 'start', prompt: 'hi', timestamp: 0 },
        { type: 'error', error: new Error('boom'), timestamp: 1 },
      ],
      new Error('boom'),
    )

    const hook = await renderHook(() => useAgentTurn({ createAgent: () => agent }))

    await act(async () => {
      await expect(hook.current().submit('hi')).resolves.toBeUndefined()
    })

    const state = hook.current()
    expect(state.state).toBe('idle')
    expect(state.lastError).toBe('boom')
    hook.unmount()
  })

  test('submit carries messages across turns', async () => {
    let turnIndex = 0
    const createAgent = (): AgentSessionLike => ({
      async *stream(_prompt, opts) {
        if (turnIndex === 0) {
          yield { type: 'start', prompt: 'hi', timestamp: 0 } as never
          yield {
            type: 'complete',
            result: {
              text: 'a',
              messages: [
                { source: 'client', role: 'user', text: 'hi' },
                { source: 'server', role: 'assistant', text: 'a' },
              ],
              iterations: 1,
              toolCalls: [],
              inputTokens: 0,
              outputTokens: 0,
              duration: 0,
              finishReason: 'complete',
            },
            timestamp: 1,
          } as never
        } else {
          expect(opts?.messages).toEqual([
            { source: 'client', role: 'user', text: 'hi' },
            { source: 'server', role: 'assistant', text: 'a' },
          ])
          yield { type: 'start', prompt: 'hi2', timestamp: 2 } as never
          yield {
            type: 'complete',
            result: {
              text: 'b',
              messages: [],
              iterations: 1,
              toolCalls: [],
              inputTokens: 0,
              outputTokens: 0,
              duration: 0,
              finishReason: 'complete',
            },
            timestamp: 3,
          } as never
        }
        turnIndex++
      },
    })

    const hook = await renderHook(() => useAgentTurn({ createAgent }))

    await act(async () => {
      await hook.current().submit('hi')
    })
    await act(async () => {
      await hook.current().submit('hi2')
    })

    hook.unmount()
  })

  test('submit is a no-op while a turn is already active', async () => {
    let createCount = 0
    const agent = {
      stream: () => {
        createCount++
        return (async function* () {
          await new Promise(() => {})
        })()
      },
    }
    const hook = await renderHook(() => useAgentTurn({ createAgent: () => agent }))

    await act(async () => {
      hook.current().submit('first')
      await Promise.resolve()
    })
    await act(async () => {
      hook.current().submit('second')
      await Promise.resolve()
    })

    expect(createCount).toBe(1)
  })

  test('cancelTool calls the agent cancelToolCall while the turn is open', async () => {
    let cancelCount = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const agent: AgentSessionLike & { cancelToolCall: () => void } = {
      async *stream() {
        yield { type: 'start', prompt: 'hi', timestamp: 0 } as never
        yield {
          type: 'tool-call-start',
          toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
          timestamp: 1,
        } as never
        // Hold the turn open so agentRef is still set when we cancel.
        await gate
      },
      cancelToolCall() {
        cancelCount++
      },
    }

    const hook = await renderHook(() => useAgentTurn({ createAgent: () => agent }))

    let submitPromise!: Promise<void>
    await act(async () => {
      submitPromise = hook.current().submit('hi')
      // Let the generator reach `await gate`.
      await new Promise((resolve) => setTimeout(resolve))
    })

    act(() => {
      hook.current().cancelTool()
    })
    expect(cancelCount).toBe(1)

    await act(async () => {
      release()
      await submitPromise
    })
    hook.unmount()
  })
})
