import type { FunctionToolCall } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { initialTurnState, type TurnState, turnReducer } from '../../src/chat/turn-reducer.js'

function apply(events: Array<Parameters<typeof turnReducer>[1]>): TurnState {
  return events.reduce((s, e) => turnReducer(s, e), initialTurnState())
}

function toolCall(id = '1'): FunctionToolCall<unknown> {
  return { id, name: 'ns:tool', arguments: '{}', raw: {} }
}

describe('turnReducer', () => {
  test('start transitions idle -> streaming', () => {
    const s = apply([{ type: 'start', prompt: 'hi', timestamp: 0 }])
    expect(s.state).toBe('streaming')
    expect(s.currentText).toBe('')
  })

  test('start and iteration-start record streamStartedAt', () => {
    const started = apply([{ type: 'start', prompt: 'hi', timestamp: 100 }])
    expect(started.streamStartedAt).toBe(100)
    const iterated = apply([
      { type: 'start', prompt: 'hi', timestamp: 100 },
      { type: 'iteration-start', iteration: 2, timestamp: 250 },
    ])
    expect(iterated.streamStartedAt).toBe(250)
  })

  test('reasoning-delta accumulates currentReasoning; iteration-start clears it', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'reasoning-delta', reasoning: 'Let me ', timestamp: 1 },
      { type: 'reasoning-delta', reasoning: 'think.', timestamp: 2 },
    ])
    expect(s.currentReasoning).toBe('Let me think.')

    const cleared = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'reasoning-delta', reasoning: 'first pass', timestamp: 1 },
      { type: 'iteration-start', iteration: 2, timestamp: 2 },
    ])
    expect(cleared.currentReasoning).toBe('')
  })

  test('text-delta accumulates currentText', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'text-delta', text: 'Hel', timestamp: 1 },
      { type: 'text-delta', text: 'lo', timestamp: 2 },
    ])
    expect(s.currentText).toBe('Hello')
  })

  test('text-complete flushes currentText into lastAssistantText and resets buffer', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'text-delta', text: 'Hi', timestamp: 1 },
      { type: 'text-complete', text: 'Hi', timestamp: 2 },
    ])
    expect(s.currentText).toBe('')
    expect(s.lastAssistantText).toBe('Hi')
  })

  test('tool-call-pending moves into awaiting-approval with the pending call', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-pending',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
    ])
    expect(s.state).toBe('awaiting-approval')
    expect(s.pendingCall?.id).toBe('1')
  })

  test('tool-call-approved moves to calling-tool and keeps pending call', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-pending',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-approved',
        toolCall: toolCall('1'),
        timestamp: 2,
      },
    ])
    expect(s.state).toBe('calling-tool')
    expect(s.pendingCall?.id).toBe('1')
  })

  test('tool-call-start (auto-approve path) sets calling-tool with pendingCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-approved',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-start',
        toolCall: toolCall('1'),
        timestamp: 2,
      },
    ])
    expect(s.state).toBe('calling-tool')
    expect(s.pendingCall?.id).toBe('1')
  })

  test('tool-call-complete returns to streaming and clears pendingCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-approved',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-start',
        toolCall: toolCall('1'),
        timestamp: 2,
      },
      {
        type: 'tool-call-complete',
        toolCall: toolCall('1'),
        result: { content: [{ type: 'text', text: 'ok' }] },
        timestamp: 3,
      },
    ])
    expect(s.state).toBe('streaming')
    expect(s.pendingCall).toBeNull()
  })

  test('tool-call-error returns to streaming and clears pendingCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-approved',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-start',
        toolCall: toolCall('1'),
        timestamp: 2,
      },
      {
        type: 'tool-call-error',
        toolCall: toolCall('1'),
        error: new Error('boom'),
        timestamp: 3,
      },
    ])
    expect(s.state).toBe('streaming')
    expect(s.pendingCall).toBeNull()
  })

  test('tool-call-denied returns to streaming without a pending call', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-pending',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-denied',
        toolCall: toolCall('1'),
        reason: 'user',
        timestamp: 2,
      },
    ])
    expect(s.state).toBe('streaming')
    expect(s.pendingCall).toBeNull()
  })

  test('complete sets messages from result and returns to idle', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'complete',
        result: {
          text: 'Hi',
          messages: [{ source: 'client', role: 'user', text: 'hi' }],
          iterations: 1,
          toolCalls: [],
          inputTokens: 0,
          outputTokens: 0,
          duration: 0,
          finishReason: 'complete',
        },
        timestamp: 3,
      },
    ])
    expect(s.state).toBe('idle')
    expect(s.messages).toEqual([{ source: 'client', role: 'user', text: 'hi' }])
  })

  test('error transitions to idle and records the error message', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'error', error: new Error('boom'), timestamp: 1 },
    ])
    expect(s.state).toBe('idle')
    expect(s.lastError).toBe('boom')
  })

  test('tool-call-start records activeToolCall with startedAt', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-start',
        toolCall: toolCall('1'),
        timestamp: 42,
      },
    ])
    expect(s.state).toBe('calling-tool')
    expect(s.activeToolCall).toEqual({
      call: toolCall('1'),
      startedAt: 42,
    })
  })

  test('tool-call-complete clears activeToolCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-start',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-complete',
        toolCall: toolCall('1'),
        result: { content: [] },
        timestamp: 2,
      },
    ])
    expect(s.activeToolCall).toBeNull()
    expect(s.state).toBe('streaming')
  })

  test('tool-call-error clears activeToolCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-start',
        toolCall: toolCall('1'),
        timestamp: 1,
      },
      {
        type: 'tool-call-error',
        toolCall: toolCall('1'),
        error: new Error('boom'),
        timestamp: 2,
      },
    ])
    expect(s.activeToolCall).toBeNull()
    expect(s.state).toBe('streaming')
  })
})
