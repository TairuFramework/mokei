import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  type MessagePart,
  ProviderError,
  type RetryInfo,
  retryDelay,
  retryStreamChat,
  type StreamChatRequest,
} from '../src/index.js'

type Part = MessagePart<unknown, unknown>

const overloaded = () =>
  new ProviderError({ message: 'overloaded', kind: 'overloaded', provider: 'test' })
const auth = () => new ProviderError({ message: 'bad key', kind: 'auth', provider: 'test' })

const text = (value: string): Part => ({ type: 'text-delta', text: value, raw: null })
const done: Part = { type: 'done', inputTokens: 1, outputTokens: 1 }

type Script = { reject: unknown } | { parts: Array<Part>; thenThrow?: unknown }

function request(script: Script): StreamChatRequest<unknown, unknown> {
  const controller = new AbortController()
  let promise: Promise<ReadableStream<Part>>
  if ('reject' in script) {
    promise = Promise.reject(script.reject)
  } else {
    const parts = [...script.parts]
    promise = Promise.resolve(
      new ReadableStream<Part>({
        pull(stream) {
          const next = parts.shift()
          if (next !== undefined) stream.enqueue(next)
          else if (script.thenThrow !== undefined) stream.error(script.thenThrow)
          else stream.close()
        },
      }),
    )
  }
  promise.catch(() => {})
  return Object.assign(promise, {
    abort: (reason?: unknown) => controller.abort(reason),
    signal: controller.signal,
  }) as StreamChatRequest<unknown, unknown>
}

function scripted(scripts: Array<Script>) {
  const start = vi.fn(() => {
    const script = scripts.shift()
    if (script == null) throw new Error('no more attempts scripted')
    return request(script)
  })
  return start
}

async function collect(stream: ReadableStream<Part>): Promise<Array<Part>> {
  const parts: Array<Part> = []
  for await (const part of stream) parts.push(part)
  return parts
}

const instant = { baseDelayMs: 0 }

describe('retryDelay', () => {
  test('full jitter over exponential backoff, capped', () => {
    const policy = { baseDelayMs: 100, maxDelayMs: 1000 }
    expect(retryDelay({ attempt: 1, error: overloaded(), policy, random: () => 0.5 })).toBe(50)
    expect(retryDelay({ attempt: 3, error: overloaded(), policy, random: () => 0.5 })).toBe(200)
    expect(retryDelay({ attempt: 10, error: overloaded(), policy, random: () => 0.999 })).toBe(999)
  })

  test('provider retry-after wins and is capped', () => {
    const error = new ProviderError({
      message: 'x',
      kind: 'rate_limit',
      provider: 'p',
      retryAfterMs: 4000,
    })
    expect(retryDelay({ attempt: 1, error })).toBe(4000)
    expect(retryDelay({ attempt: 1, error, policy: { maxDelayMs: 1000 } })).toBe(1000)
  })
})

describe('retryStreamChat', () => {
  test('retries a rejected request, then streams', async () => {
    const start = scripted([{ reject: overloaded() }, { parts: [text('hi'), done] }])
    const retries: Array<RetryInfo> = []
    const stream = await retryStreamChat({
      start,
      policy: instant,
      onRetry: (info) => retries.push(info),
    })
    expect(await collect(stream)).toEqual([text('hi'), done])
    expect(start).toHaveBeenCalledTimes(2)
    expect(retries).toHaveLength(1)
    expect(retries[0]).toMatchObject({ attempt: 1, maxRetries: 2 })
    expect(retries[0]?.error).toBeInstanceOf(ProviderError)
  })

  test('retries an error part before output', async () => {
    const start = scripted([
      { parts: [{ type: 'error', error: overloaded() }] },
      { parts: [text('ok'), done] },
    ])
    const stream = await retryStreamChat({ start, policy: instant })
    expect(await collect(stream)).toEqual([text('ok'), done])
  })

  test('retries a stream failure before output, replaying parts read meanwhile', async () => {
    const unsupported: Part = { type: 'unsupported', raw: 'ping' }
    const start = scripted([
      { parts: [unsupported], thenThrow: overloaded() },
      { parts: [unsupported, text('ok')] },
    ])
    const stream = await retryStreamChat({ start, policy: instant })
    expect(await collect(stream)).toEqual([unsupported, text('ok')])
  })

  test('does not retry after output', async () => {
    const start = scripted([
      { parts: [text('partial'), { type: 'error', error: overloaded() }] },
      { parts: [text('never')] },
    ])
    const stream = await retryStreamChat({ start, policy: instant })
    const parts = await collect(stream)
    expect(parts.map((part) => part.type)).toEqual(['text-delta', 'error'])
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('a non-retryable rejection is thrown unchanged', async () => {
    const error = auth()
    const start = scripted([{ reject: error }])
    await expect(retryStreamChat({ start, policy: instant })).rejects.toBe(error)
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('a non-retryable error part reaches the consumer', async () => {
    const error = auth()
    const start = scripted([{ parts: [{ type: 'error', error }] }])
    const parts = await collect(await retryStreamChat({ start, policy: instant }))
    expect(parts).toEqual([{ type: 'error', error }])
  })

  test('gives up after the policy retries', async () => {
    const last = overloaded()
    const start = scripted([{ reject: overloaded() }, { reject: overloaded() }, { reject: last }])
    await expect(retryStreamChat({ start, policy: instant })).rejects.toBe(last)
    expect(start).toHaveBeenCalledTimes(3)
  })

  test('policy false disables retries', async () => {
    const error = overloaded()
    const start = scripted([{ reject: error }])
    await expect(retryStreamChat({ start, policy: false })).rejects.toBe(error)
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('custom shouldRetry', async () => {
    const start = scripted([{ reject: new Error('flaky') }, { parts: [done] }])
    const stream = await retryStreamChat({
      start,
      policy: { ...instant, shouldRetry: (error) => (error as Error).message === 'flaky' },
    })
    expect(await collect(stream)).toEqual([done])
  })

  describe('waiting', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    test('waits the provider retry-after', async () => {
      const error = new ProviderError({
        message: 'x',
        kind: 'rate_limit',
        provider: 'p',
        retryAfterMs: 2000,
      })
      const start = scripted([{ reject: error }, { parts: [done] }])
      const result = retryStreamChat({ start })
      await vi.advanceTimersByTimeAsync(1999)
      expect(start).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(start).toHaveBeenCalledTimes(2)
      expect(await collect(await result)).toEqual([done])
    })

    test('abort ends the wait at once', async () => {
      const start = scripted([{ reject: overloaded() }, { parts: [done] }])
      const signal = new AbortController()
      const result = retryStreamChat({
        start,
        policy: { baseDelayMs: 10_000 },
        signal: signal.signal,
        random: () => 0.99,
      })
      const rejection = expect(result).rejects.toBe('stop')
      await vi.advanceTimersByTimeAsync(10)
      signal.abort('stop')
      await rejection
      expect(start).toHaveBeenCalledTimes(1)
    })

    test('abort() on the request ends the wait', async () => {
      const start = scripted([{ reject: overloaded() }, { parts: [done] }])
      const result = retryStreamChat({ start, policy: { baseDelayMs: 10_000 }, random: () => 0.9 })
      const rejection = expect(result).rejects.toBe('cancel')
      await vi.advanceTimersByTimeAsync(10)
      result.abort('cancel')
      await rejection
      expect(start).toHaveBeenCalledTimes(1)
    })
  })
})
