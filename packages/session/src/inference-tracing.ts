import {
  capturePayload,
  endSpanError,
  getMokeiTracer,
  type PayloadCapture,
  resolvePayloadCap,
} from '@mokei/context-client'
import type { Tool } from '@mokei/context-protocol'
import {
  type MessagePart,
  normalizeFinishReason,
  type ProviderTelemetry,
  type StreamChatParams,
  type StreamChatRequest,
} from '@mokei/model-provider'
import { type Attributes, SpanKind } from '@opentelemetry/api'

import {
  type OutputContent,
  toInputMessages,
  toOutputMessages,
  toSystemInstructions,
  toToolDefinitions,
} from './gen-ai-content.js'
import {
  genAIInstruments,
  genAIMetricsEnabled,
  type InferenceUsage,
  recordInferenceUsage,
} from './gen-ai-metrics.js'

export type TraceStreamChatParams<TPart, TCall> = {
  telemetry?: ProviderTelemetry
  request: StreamChatParams<unknown, TCall, unknown>
  /** MCP definitions of the tools offered to the model, for `gen_ai.tool.definitions` */
  tools?: Array<Tool>
  capture: PayloadCapture
  start: () => StreamChatRequest<TPart, TCall>
}

type DonePart = Extract<MessagePart<unknown, unknown>, { type: 'done' }>

function errorType(error: unknown, aborted: boolean): string {
  if (aborted || (error instanceof Error && error.name === 'AbortError')) return 'cancelled'
  return error instanceof Error && error.name !== 'Error' ? error.name : '_OTHER'
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

function usageFromDone(done: DonePart, telemetry: ProviderTelemetry | undefined): InferenceUsage {
  const cacheRead = done.cacheReadInputTokens ?? 0
  const cacheWrite = done.cacheWriteInputTokens ?? 0
  return {
    input: done.inputTokens + (telemetry?.inputTokensExcludeCache ? cacheRead + cacheWrite : 0),
    output: done.outputTokens,
    'cache_read.input': cacheRead,
    'cache_write.input': cacheWrite,
    'reasoning.output': done.reasoningOutputTokens ?? 0,
  }
}

/**
 * Wrap a provider chat request in a GenAI inference span. The span starts with `start()` and
 * ends once: when the stream completes, errors, is cancelled, or the request rejects.
 */
export function traceStreamChat<TPart, TCall>(
  params: TraceStreamChatParams<TPart, TCall>,
): StreamChatRequest<TPart, TCall> {
  const { telemetry, request, capture } = params
  const startTime = performance.now()

  const baseAttributes: Attributes = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': request.model,
  }
  if (telemetry?.providerName != null) {
    baseAttributes['gen_ai.provider.name'] = telemetry.providerName
  }
  if (telemetry?.serverAddress != null) baseAttributes['server.address'] = telemetry.serverAddress
  if (telemetry?.serverPort != null) baseAttributes['server.port'] = telemetry.serverPort

  // Sampling-relevant attributes must be present at span creation.
  const spanAttributes: Attributes = { ...baseAttributes, 'gen_ai.request.stream': true }
  if (request.temperature != null)
    spanAttributes['gen_ai.request.temperature'] = request.temperature
  if (request.maxTokens != null) spanAttributes['gen_ai.request.max_tokens'] = request.maxTokens
  if (request.topP != null) spanAttributes['gen_ai.request.top_p'] = request.topP
  if (request.output != null) spanAttributes['gen_ai.output.type'] = 'json'

  const span = getMokeiTracer('session').startSpan(`chat ${request.model}`, {
    kind: telemetry?.local ? SpanKind.INTERNAL : SpanKind.CLIENT,
    attributes: spanAttributes,
  })

  // Content is costly to build and redact; skip it for unsampled or no-op spans.
  const captureContent = span.isRecording() && resolvePayloadCap(capture) !== null
  let truncated = false
  function setContent(key: string, value: unknown): void {
    const captured = capturePayload(value, capture)
    if (captured === undefined) return
    span.setAttribute(key, captured.payload)
    if (captured.truncated && !truncated) {
      truncated = true
      span.setAttribute('mokei.payload.truncated', true)
    }
  }
  if (captureContent) {
    setContent('gen_ai.input.messages', toInputMessages(request.messages))
    const instructions = toSystemInstructions(request.messages)
    if (instructions !== undefined) setContent('gen_ai.system_instructions', instructions)
    if (params.tools !== undefined && params.tools.length > 0) {
      setContent('gen_ai.tool.definitions', toToolDefinitions(params.tools))
    }
  }

  const metricsEnabled = genAIMetricsEnabled()
  const output: OutputContent & { text: string; reasoning: string } = { text: '', reasoning: '' }
  let done: DonePart | undefined
  let lastChunkAt: number | undefined
  let ended = false

  function finish(failure?: { type: string; message?: string }): void {
    if (ended) return
    ended = true
    if (failure === undefined) {
      span.end()
    } else {
      endSpanError(span, failure.type, failure.message)
    }
    if (!metricsEnabled) return
    const attributes = { ...baseAttributes }
    if (done?.responseModel != null) attributes['gen_ai.response.model'] = done.responseModel
    genAIInstruments().duration.record(
      (performance.now() - startTime) / 1000,
      failure === undefined ? attributes : { ...attributes, 'error.type': failure.type },
    )
    recordInferenceUsage(
      done === undefined ? undefined : usageFromDone(done, telemetry),
      attributes,
    )
  }

  // Only output-bearing parts are timed; `done` and `error` carry no generated content.
  function timeOutputChunk(): void {
    const now = performance.now()
    if (lastChunkAt === undefined) {
      const seconds = (now - startTime) / 1000
      span.setAttribute('gen_ai.response.time_to_first_chunk', seconds)
      if (metricsEnabled) genAIInstruments().timeToFirstChunk.record(seconds, baseAttributes)
    } else if (metricsEnabled) {
      genAIInstruments().timePerOutputChunk.record((now - lastChunkAt) / 1000, baseAttributes)
    }
    lastChunkAt = now
  }

  function onChunk(part: MessagePart<TPart, TCall>): void {
    if (
      part.type === 'text-delta' ||
      part.type === 'reasoning-delta' ||
      part.type === 'tool-call'
    ) {
      timeOutputChunk()
    }

    switch (part.type) {
      case 'text-delta':
        if (captureContent) output.text += part.text
        break
      case 'reasoning-delta':
        if (captureContent) output.reasoning += part.reasoning
        break
      case 'tool-call':
        if (captureContent) output.toolCalls = [...(output.toolCalls ?? []), ...part.toolCalls]
        break
      case 'done': {
        done = part
        const finishReason = normalizeFinishReason(part.reason)
        const usage = usageFromDone(part, telemetry)
        const attributes: Attributes = {
          'gen_ai.response.finish_reasons': [finishReason],
          'gen_ai.usage.input_tokens': usage.input,
          'gen_ai.usage.output_tokens': usage.output,
        }
        if (part.responseID != null) attributes['gen_ai.response.id'] = part.responseID
        if (part.responseModel != null) attributes['gen_ai.response.model'] = part.responseModel
        if (usage['cache_read.input']) {
          attributes['gen_ai.usage.cache_read.input_tokens'] = usage['cache_read.input']
        }
        if (usage['cache_write.input']) {
          attributes['gen_ai.usage.cache_write.input_tokens'] = usage['cache_write.input']
        }
        if (usage['reasoning.output']) {
          attributes['gen_ai.usage.reasoning.output_tokens'] = usage['reasoning.output']
        }
        span.setAttributes(attributes)
        if (captureContent) {
          setContent('gen_ai.output.messages', toOutputMessages(output, finishReason))
        }
        break
      }
      case 'error':
        finish({ type: errorType(part.error, false), message: errorMessage(part.error) })
        break
    }
  }

  let inner: StreamChatRequest<TPart, TCall>
  try {
    inner = params.start()
  } catch (error) {
    finish({ type: errorType(error, false), message: errorMessage(error) })
    throw error
  }
  const isAborted = () => inner.signal.aborted || request.signal?.aborted === true

  // Providers may return a bare thenable; normalise to a real Promise before decorating.
  const traced = Promise.resolve(inner).then(
    (stream) => {
      const reader = stream.getReader()
      return new ReadableStream<MessagePart<TPart, TCall>>(
        {
          async pull(controller) {
            let result: ReadableStreamReadResult<MessagePart<TPart, TCall>>
            try {
              result = await reader.read()
            } catch (error) {
              finish({ type: errorType(error, isAborted()), message: errorMessage(error) })
              throw error
            }
            if (result.done) {
              // Providers may close gracefully on abort; without `done` the turn was cut short.
              finish(done === undefined && isAborted() ? { type: 'cancelled' } : undefined)
              controller.close()
              return
            }
            onChunk(result.value)
            controller.enqueue(result.value)
          },
          cancel(reason) {
            finish({ type: 'cancelled' })
            return reader.cancel(reason)
          },
        },
        // No read-ahead: chunks flow only when the consumer reads.
        { highWaterMark: 0 },
      )
    },
    (error: unknown) => {
      finish({ type: errorType(error, isAborted()), message: errorMessage(error) })
      throw error
    },
  )
  return Object.assign(traced, {
    abort: (reason?: unknown) => inner.abort(reason),
    signal: inner.signal,
  }) as StreamChatRequest<TPart, TCall>
}
