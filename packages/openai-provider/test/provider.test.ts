import { describe, expect, test } from 'vitest'

import { DEFAULT_TIMEOUT as ANTHROPIC_DEFAULT_TIMEOUT } from '../../anthropic-provider/src/config.js'
import { OpenAIClient } from '../src/client.js'
import { DEFAULT_TIMEOUT } from '../src/config.js'
import { OpenAIProvider } from '../src/provider.js'
import type { ChatCompletionChunk, Message, ToolCall } from '../src/types.js'

describe('OpenAIProvider construction', () => {
  test('constructs with no arguments', () => {
    const provider = new OpenAIProvider()
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  test('default timeout is standardized to 30s across providers', () => {
    expect(DEFAULT_TIMEOUT).toBe(30_000)
    expect(ANTHROPIC_DEFAULT_TIMEOUT).toBe(30_000)
  })
})

function chunk(delta: Partial<Message>, finishReason: string | null = null): ChatCompletionChunk {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

/** Provider whose client replays `chunks` instead of reaching a server. */
function providerReplaying(chunks: Array<ChatCompletionChunk>): OpenAIProvider {
  const client = new OpenAIClient()
  const stream = new ReadableStream<ChatCompletionChunk>({
    start(controller) {
      for (const part of chunks) {
        controller.enqueue(part)
      }
      controller.close()
    },
  })
  const request = Object.assign(Promise.resolve(stream), {
    abort: () => {},
    signal: new AbortController().signal,
  })
  // biome-ignore lint/suspicious/noExplicitAny: replaces an overloaded method on a test double
  ;(client as any).chat = () => request
  return new OpenAIProvider({ client })
}

async function collectParts(provider: OpenAIProvider, chunks: Array<ChatCompletionChunk>) {
  const stream = await provider.streamChat({
    model: 'test-model',
    messages: [{ source: 'client', role: 'user', text: 'hi' }],
  })
  const parts = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return { parts, chunks }
}

describe('OpenAIProvider reasoning', () => {
  /**
   * OpenAI-compatible servers that split thinking from the answer (llama.cpp with
   * `--reasoning-format deepseek`, DeepSeek, vLLM) send `reasoning_content`; OpenRouter
   * sends `reasoning`. Both must reach the consumer as `reasoning-delta`, otherwise the
   * thinking text is silently dropped and UIs gating on reasoning never show it.
   */
  test('maps reasoning_content deltas to reasoning-delta parts', async () => {
    const chunks = [
      chunk({ role: 'assistant', content: null }),
      chunk({ reasoning_content: 'Let me think. ' }),
      chunk({ reasoning_content: 'Done thinking.' }),
      chunk({ content: 'Hello' }),
      chunk({}, 'stop'),
    ]
    const { parts } = await collectParts(providerReplaying(chunks), chunks)
    expect(parts.map((part) => part.type)).toEqual([
      'reasoning-delta',
      'reasoning-delta',
      'text-delta',
      'done',
    ])
    expect(parts[0]).toMatchObject({ type: 'reasoning-delta', reasoning: 'Let me think. ' })
    expect(parts[2]).toMatchObject({ type: 'text-delta', text: 'Hello' })
  })

  test('maps the OpenRouter `reasoning` field too', async () => {
    const chunks = [chunk({ reasoning: 'thinking' }), chunk({}, 'stop')]
    const { parts } = await collectParts(providerReplaying(chunks), chunks)
    expect(parts[0]).toMatchObject({ type: 'reasoning-delta', reasoning: 'thinking' })
  })

  test('emits no reasoning part when the server leaves thoughts inline', async () => {
    const chunks = [chunk({ content: '<think>inline</think>answer' }), chunk({}, 'stop')]
    const { parts } = await collectParts(providerReplaying(chunks), chunks)
    expect(parts.map((part) => part.type)).toEqual(['text-delta', 'done'])
  })

  test('aggregateMessage concatenates reasoning alongside text', () => {
    const provider = new OpenAIProvider()
    const raw = chunk({})
    const aggregated = provider.aggregateMessage([
      { source: 'server', role: 'assistant', reasoning: 'think ', raw },
      { source: 'server', role: 'assistant', reasoning: 'more', raw },
      { source: 'server', role: 'assistant', text: 'answer', raw },
    ] as Array<Parameters<OpenAIProvider['aggregateMessage']>[0][number]>)
    expect(aggregated).toMatchObject({ text: 'answer', reasoning: 'think more' })
  })

  test('aggregateMessage reports empty reasoning when none was streamed', () => {
    const provider = new OpenAIProvider()
    const toolCall: ToolCall = {
      id: 'call-1',
      type: 'function',
      function: { name: 'get', arguments: '{}' },
    }
    const aggregated = provider.aggregateMessage([
      { source: 'server', role: 'assistant', text: 'answer', raw: chunk({}) },
      {
        source: 'server',
        role: 'assistant',
        toolCalls: [{ name: 'get', arguments: '{}', id: 'call-1', raw: toolCall }],
        raw: chunk({}),
      },
    ] as Array<Parameters<OpenAIProvider['aggregateMessage']>[0][number]>)
    expect(aggregated.reasoning).toBe('')
    expect(aggregated.toolCalls).toHaveLength(1)
  })
})
