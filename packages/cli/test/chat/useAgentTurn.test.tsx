// @vitest-environment jsdom
import React, { act, useEffect } from 'react'
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
})
