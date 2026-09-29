import { TaskCancelledError } from '@mokei/context-client'
import type { CallToolResult, InputRequest } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type { JSONValue } from '@mokei/context-server'
import { type TaskHandle, TaskInputKeyReusedError } from '@mokei/context-server'
import type { FlowDefinition, FlowGraph, FlowRun, RunState } from '@sozai/flow-graph'

import { toElicitationSchema } from './definition-checks.js'
import type { ToolCaller } from './tool-caller.js'
import type { ToolResumeValue, ToolSuspendData } from './tool-node.js'

export type ResumeDataV1 = {
  v: 1
  flow: { definition: FlowDefinition } | { id: string; digest: string }
  approved: Array<string>
  depth: number
  runState: RunState
  siblings: Array<{ tool: string; taskId: string }>
  inputSeq?: number
}

const stopped: CallToolResult = { content: [] }

class StopRun extends Error {}

function isTerminalCheckpoint(error: unknown): boolean {
  return error instanceof Error && error.message === 'Task is no longer active'
}

function isToolSuspension(data: unknown): data is ToolSuspendData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'tool' in data &&
    typeof data.tool === 'string' &&
    'taskId' in data &&
    typeof data.taskId === 'string'
  )
}

function waitUntil(when: string, signal: AbortSignal): Promise<void> {
  const remaining = Math.max(0, new Date(when).getTime() - Date.now())
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, remaining)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function startRun(params: {
  handle: TaskHandle
  graph: FlowGraph
  run: FlowRun
  definition: FlowDefinition
  resumeData: ResumeDataV1
  caller: ToolCaller
}): Promise<CallToolResult> {
  const { handle, graph, definition, resumeData, caller } = params
  let run = params.run
  let driveSegment = resumeData.runState.status === 'running'
  const siblings = resumeData.siblings
  const cancelled = new Set<string>()
  let cleanupPromise: Promise<void> = Promise.resolve()
  function cleanup(): Promise<void> {
    const newCancels = siblings.filter(({ tool, taskId }) => !cancelled.has(`${tool}:${taskId}`))
    for (const { tool, taskId } of newCancels) cancelled.add(`${tool}:${taskId}`)
    cleanupPromise = Promise.all([
      cleanupPromise,
      ...newCancels.map(async ({ tool, taskId }) => {
        try {
          await caller.cancelTask({ id: tool, taskId })
        } catch (error) {
          console.error('Flow sibling cancellation failed', error)
        }
      }),
    ]).then(() => {})
    return cleanupPromise
  }
  const onAbort = () => {
    void cleanup()
  }
  handle.signal.addEventListener('abort', onAbort, { once: true })

  async function checkpoint(): Promise<void> {
    try {
      await handle.checkpoint(resumeData as unknown as JSONValue)
    } catch (error) {
      if (handle.signal.aborted || isTerminalCheckpoint(error))
        throw new StopRun('Run stopped', { cause: error })
      // biome-ignore lint/style/useErrorCause: RPCError takes cause in its options object.
      throw new RPCError({ code: -32603, message: 'Flow checkpoint failed', cause: error })
    }
  }

  function terminal(state: RunState): CallToolResult | undefined {
    if (state.status === 'ended') {
      return {
        content: [{ type: 'text', text: `Flow ended: ${state.outcome ?? 'completed'}` }],
        structuredContent: {
          ...(state.outcome !== undefined && { outcome: state.outcome }),
          output: state.output ?? {},
        },
      }
    }
    if (state.status === 'error') {
      return {
        isError: true,
        content: [{ type: 'text', text: `Flow error: ${state.error?.code ?? 'unknown'}` }],
        structuredContent: { error: state.error ?? { code: 'unknown', name: 'Error' } },
      }
    }
    return undefined
  }

  async function suspended(state: RunState): Promise<FlowRun | CallToolResult> {
    const pending = state.pending
    if (pending === undefined) throw new Error('Suspended flow has no pending work')
    if (pending.reason === 'retry') {
      if (pending.resumeAt === undefined) throw new Error('Retry has no resume time')
      await waitUntil(pending.resumeAt, handle.signal)
      return graph.resume({
        definition,
        runState: state,
        event: { type: 'retry' },
        signal: handle.signal,
      })
    }
    if (isToolSuspension(pending.data)) {
      const { tool, taskId } = pending.data
      let value: ToolResumeValue
      try {
        value = {
          ok: true,
          result: await caller.waitTask({ id: tool, taskId, signal: handle.signal }),
        }
      } catch (error) {
        if (handle.signal.aborted) throw new StopRun('Run stopped', { cause: error })
        value =
          error instanceof TaskCancelledError
            ? { ok: false, status: 'cancelled' }
            : { ok: false, status: 'failed' }
      }
      const index = siblings.findIndex(
        (sibling) => sibling.tool === tool && sibling.taskId === taskId,
      )
      if (index >= 0) siblings.splice(index, 1)
      await checkpoint()
      return graph.resume({
        definition,
        runState: state,
        event: { type: 'value', value: value as unknown as JSONValue },
        signal: handle.signal,
      })
    }
    if (typeof pending.prompt !== 'string') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Input prompt is not a string' }],
        structuredContent: { error: { type: 'input_prompt_not_string', node: pending.node } },
      }
    }
    const form = toElicitationSchema(pending.schema)
    if (form === undefined) throw new Error('Input schema cannot be elicited')
    let event: { type: 'timeout' } | { type: 'value'; value: JSONValue }
    if (pending.deadline !== undefined && Date.now() >= new Date(pending.deadline).getTime()) {
      event = { type: 'timeout' }
    } else {
      const deadlineController = new AbortController()
      const timeout =
        pending.deadline === undefined
          ? undefined
          : setTimeout(
              () => deadlineController.abort(new Error('Input deadline expired')),
              Math.max(0, new Date(pending.deadline).getTime() - Date.now()),
            )
      const signal = AbortSignal.any([handle.signal, deadlineController.signal])
      const frame = state.frames.at(-1)
      const invocationID =
        frame?.attempts[pending.node]?.invocationID ?? `${pending.node}.${frame?.invocation ?? 0}`
      try {
        while (true) {
          const key = `${state.runID}:${invocationID}:input:${resumeData.inputSeq ?? 0}`
          let responses: Awaited<ReturnType<TaskHandle['requestInput']>>
          try {
            responses = await handle.requestInput(
              {
                [key]: {
                  method: 'elicitation/create',
                  params: { message: pending.prompt, requestedSchema: form.requestedSchema },
                } as InputRequest,
              },
              { signal },
            )
          } catch (error) {
            if (!(error instanceof TaskInputKeyReusedError)) throw error
            resumeData.inputSeq = (resumeData.inputSeq ?? 0) + 1
            await checkpoint()
            continue
          }
          const response = responses[key]
          if (response?.action !== 'accept') {
            await cleanup()
            await handle.cancel()
            return stopped
          }
          const content = (response.content ?? {}) as Record<string, JSONValue>
          event = { type: 'value', value: (form.wrapped ? content.value : content) as JSONValue }
          break
        }
      } catch (error) {
        if (handle.signal.aborted) throw new StopRun('Run stopped', { cause: error })
        if (!deadlineController.signal.aborted) throw error
        event = { type: 'timeout' }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    }
    return graph.resume({ definition, runState: state, event, signal: handle.signal })
  }

  try {
    while (true) {
      if (handle.signal.aborted) return stopped
      const state = resumeData.runState
      const result = terminal(state)
      if (result !== undefined) return result
      if (state.status === 'aborted') {
        await handle.cancel()
        return stopped
      }
      if (state.status === 'suspended' && !driveSegment) {
        const next = await suspended(state)
        if (Symbol.asyncIterator in next) {
          run = next
          driveSegment = true
          continue
        }
        return next
      }
      const statuses: Array<Promise<void>> = []
      const off = run.events.on('node:enter', ({ node }) => {
        statuses.push(
          handle.setStatus(`Running node ${node}`).catch((error) => {
            if (!handle.signal.aborted) throw error
          }),
        )
      })
      let step: IteratorResult<RunState, RunState>
      try {
        step = await run.next()
        await Promise.all(statuses)
      } finally {
        off()
      }
      if (step.done) {
        resumeData.runState = step.value
        driveSegment = false
        continue
      }
      resumeData.runState = step.value
      driveSegment = step.value.status === 'running'
      const pending = step.value.pending
      if (step.value.status === 'suspended' && pending && isToolSuspension(pending.data)) {
        const sibling = pending.data
        if (
          !siblings.some((item) => item.tool === sibling.tool && item.taskId === sibling.taskId)
        ) {
          siblings.push({ tool: sibling.tool, taskId: sibling.taskId })
        }
      }
      await checkpoint()
    }
  } catch (error) {
    if (error instanceof StopRun || handle.signal.aborted) return stopped
    throw error
  } finally {
    handle.signal.removeEventListener('abort', onAbort)
    await cleanup()
  }
}
