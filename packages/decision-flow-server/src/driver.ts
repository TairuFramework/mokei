import { TaskCancelledError } from '@mokei/context-client'
import type { CallToolResult, InputRequest, InputResponse } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type { JSONValue } from '@mokei/context-server'
import {
  InputRequestWithdrawnError,
  type TaskHandle,
  TaskInputKeyReusedError,
} from '@mokei/context-server'
import type { FlowDefinition, FlowGraph, FlowRun, RunState } from '@sozai/flow-graph'

import { toElicitationSchema } from './definition-checks.js'
import { cancelSibling, type ToolCaller } from './tool-caller.js'
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

export function terminalResult(state: RunState): CallToolResult | undefined {
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
          await cancelSibling(caller, { id: tool, taskId })
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
      const attemptDeadline =
        pending.deadline === undefined ? undefined : Date.parse(pending.deadline)
      const totalDeadline = state.frames.at(-1)?.attempts[pending.node]?.deadline
      const deadline = [
        attemptDeadline,
        totalDeadline === undefined ? undefined : Date.parse(totalDeadline),
      ]
        .filter((time): time is number => time !== undefined)
        .reduce<number | undefined>(
          (earlier, time) => (earlier === undefined ? time : Math.min(earlier, time)),
          undefined,
        )
      const deadlineController = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const now = Date.now()
      let expired = deadline !== undefined && now >= deadline
      let attemptExpired = expired && attemptDeadline !== undefined && now >= attemptDeadline
      let value: ToolResumeValue
      try {
        if (!expired) {
          const signal = AbortSignal.any([handle.signal, deadlineController.signal])
          const waiting = caller.waitTask({ id: tool, taskId, signal })
          const result =
            deadline === undefined
              ? await waiting
              : await Promise.race([
                  waiting,
                  new Promise<never>((_resolve, reject) => {
                    const expire = () => {
                      const now = Date.now()
                      if (now < deadline) {
                        timeout = setTimeout(expire, deadline - now)
                        return
                      }
                      expired = true
                      attemptExpired = attemptDeadline !== undefined && now >= attemptDeadline
                      const error = new Error('Sibling task deadline expired')
                      deadlineController.abort(error)
                      reject(error)
                    }
                    timeout = setTimeout(expire, Math.max(0, deadline - Date.now()))
                  }),
                ])
          value = { ok: true, result }
        } else throw new Error('Sibling task deadline expired')
      } catch (error) {
        if (handle.signal.aborted) throw new StopRun('Run stopped', { cause: error })
        if (expired || !(error instanceof TaskCancelledError)) {
          try {
            await cancelSibling(caller, { id: tool, taskId })
          } catch (cancelError) {
            console.error('Flow sibling cancellation failed', cancelError)
          }
        }
        value =
          error instanceof TaskCancelledError
            ? { ok: false, status: 'cancelled' }
            : { ok: false, status: 'failed' }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
      const index = siblings.findIndex(
        (sibling) => sibling.tool === tool && sibling.taskId === taskId,
      )
      if (index >= 0) siblings.splice(index, 1)
      await checkpoint()
      return graph.resume({
        definition,
        runState: state,
        event:
          expired && attemptExpired
            ? { type: 'timeout' }
            : { type: 'value', value: value as unknown as JSONValue },
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
    const wrapped = form.wrapped
    const frame = state.frames.at(-1)
    const invocationID =
      frame?.attempts[pending.node]?.invocationID ?? `${pending.node}.${frame?.invocation ?? 0}`
    // Deterministic from the run state, so a recovered run re-attaches to or replays the request.
    const key = `${state.runID}:${invocationID}:input:${resumeData.inputSeq ?? 0}`
    const request = {
      [key]: {
        method: 'elicitation/create',
        params: { message: pending.prompt, requestedSchema: form.requestedSchema },
      } as InputRequest,
    }
    const expired = new Error('Input deadline expired')
    /** Asks for the request; a reused key is a bug and fails the run. */
    async function ask(signal: AbortSignal): Promise<Record<string, InputResponse>> {
      try {
        return await handle.requestInput(request, { signal })
      } catch (error) {
        if (!(error instanceof TaskInputKeyReusedError)) throw error
        // biome-ignore lint/style/useErrorCause: RPCError takes cause in its options object.
        throw new RPCError({ code: -32603, message: 'Flow input key reused', cause: error })
      }
    }
    const isTimeout = (error: unknown) =>
      error === expired || error instanceof InputRequestWithdrawnError

    /** The value event for an accepted answer; declining or cancelling ends the task. */
    async function answered(
      responses: Record<string, InputResponse>,
    ): Promise<{ type: 'value'; value: JSONValue } | { type: 'stopped' }> {
      const response = responses[key]
      if (response?.action !== 'accept') {
        await cleanup()
        await handle.cancel()
        return { type: 'stopped' }
      }
      const content = (response.content ?? {}) as Record<string, JSONValue>
      return { type: 'value', value: (wrapped ? content.value : content) as JSONValue }
    }

    const deadline = pending.deadline === undefined ? undefined : Date.parse(pending.deadline)
    let responses: Record<string, InputResponse> | undefined
    if (deadline !== undefined && Date.now() >= deadline) {
      // Replays a stored answer, withdraws an open request, and never issues a new one.
      try {
        responses = await ask(AbortSignal.abort(expired))
      } catch (error) {
        if (!isTimeout(error)) throw error
      }
    } else {
      const deadlineController = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      if (deadline !== undefined) {
        // Timers can fire early: re-arm until the deadline has passed, or resume rejects timeout.
        const expire = () => {
          const remaining = deadline - Date.now()
          if (remaining > 0) timeout = setTimeout(expire, remaining)
          else deadlineController.abort(expired)
        }
        timeout = setTimeout(expire, Math.max(0, deadline - Date.now()))
      }
      const signal = AbortSignal.any([handle.signal, deadlineController.signal])
      try {
        responses = await ask(signal)
      } catch (error) {
        if (handle.signal.aborted) throw new StopRun('Run stopped', { cause: error })
        if (!deadlineController.signal.aborted || !isTimeout(error)) throw error
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    }
    const event = responses === undefined ? { type: 'timeout' as const } : await answered(responses)
    if (event.type === 'stopped') return stopped
    return graph.resume({ definition, runState: state, event, signal: handle.signal })
  }

  try {
    while (true) {
      if (handle.signal.aborted) return stopped
      const state = resumeData.runState
      const result = terminalResult(state)
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
            if (handle.signal.aborted || isTerminalCheckpoint(error))
              throw new StopRun('Run stopped', { cause: error })
            throw new RPCError({ code: -32603, message: 'Flow status update failed', cause: error })
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
