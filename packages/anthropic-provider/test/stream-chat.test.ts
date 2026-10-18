import type { MessagePart } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { AnthropicClient } from '../src/client.js'
import { AnthropicProvider } from '../src/provider.js'
import type { StreamEvent, ToolCall } from '../src/types.js'

function streamOf(events: Array<StreamEvent>): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event)
      controller.close()
    },
  })
}

function providerWithEvents(events: Array<StreamEvent>): AnthropicProvider {
  const client = new AnthropicClient({ apiKey: 'test' })
  const controller = new AbortController()
  // Override the network call with a fixture stream.
  ;(client as unknown as { messages: () => unknown }).messages = () =>
    Object.assign(Promise.resolve(streamOf(events)), {
      abort: () => controller.abort(),
      signal: controller.signal,
    })
  return new AnthropicProvider({ client })
}

async function collect(
  stream: ReadableStream<MessagePart<StreamEvent, ToolCall>>,
): Promise<Array<MessagePart<StreamEvent, ToolCall>>> {
  const parts: Array<MessagePart<StreamEvent, ToolCall>> = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

describe('AnthropicProvider.streamChat', () => {
  test('done part carries input tokens captured at message_start', async () => {
    const provider = providerWithEvents([
      { type: 'message_start', message: { usage: { input_tokens: 10 } } } as unknown as StreamEvent,
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hi' },
      } as unknown as StreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      } as unknown as StreamEvent,
    ])
    const stream = await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    const parts = await collect(stream)
    const done = parts.find((p) => p.type === 'done')
    expect(done).toBeDefined()
    expect((done as { inputTokens: number }).inputTokens).toBe(10)
    expect((done as { outputTokens: number }).outputTokens).toBe(5)
  })

  test('malformed streamed tool JSON does not abort the stream', async () => {
    const provider = providerWithEvents([
      { type: 'message_start', message: { usage: { input_tokens: 3 } } } as unknown as StreamEvent,
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 't1', name: 'do_thing' },
      } as unknown as StreamEvent,
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{bad json' },
      } as unknown as StreamEvent,
      { type: 'content_block_stop' } as unknown as StreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 1 },
      } as unknown as StreamEvent,
    ])
    const stream = await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    // Must complete without throwing, and still emit the tool-call + done.
    const parts = await collect(stream)
    expect(parts.some((p) => p.type === 'tool-call')).toBe(true)
    expect(parts.some((p) => p.type === 'done')).toBe(true)
  })
})

describe('AnthropicProvider telemetry', () => {
  test('exposes provider telemetry', () => {
    expect(new AnthropicProvider().telemetry).toEqual({
      providerName: 'anthropic',
      serverAddress: 'api.anthropic.com',
      serverPort: 443,
      inputTokensExcludeCache: true,
    })
  })

  test('done carries response metadata and cache tokens', async () => {
    const provider = providerWithEvents([
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          model: 'claude-y',
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 3,
          },
        },
      } as unknown as StreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      } as unknown as StreamEvent,
    ])
    const stream = await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    const done = (await collect(stream)).find((p) => p.type === 'done')
    expect(done).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      responseID: 'msg_1',
      responseModel: 'claude-y',
      cacheReadInputTokens: 7,
      cacheWriteInputTokens: 3,
    })
  })
})
