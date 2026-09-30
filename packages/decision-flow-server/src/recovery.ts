import type { CallToolResult } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type {
  InputRecord,
  JSONValue,
  TaskManagerParams,
  TaskRecord,
  ToolDefinitions,
} from '@mokei/context-server'
import type { Predictor } from '@mokei/decision-flow'
import { digestDefinition, type FlowDefinition } from '@sozai/flow-graph'

import { checkFlow } from './definition-checks.js'
import { type ResumeDataV1, startRun, terminalResult } from './driver.js'
import type { PredictorFactory } from './predictor.js'
import { cancelSibling, type ToolCaller } from './tool-caller.js'

const recoveryOnlyTool: ToolDefinitions[string] = {
  description: 'Recover a persisted decision flow',
  inputSchema: { type: 'object' },
  outputSchema: {
    type: 'object',
    properties: {
      outcome: { type: 'string' },
      output: { type: 'object' },
      error: { type: 'object' },
    },
  },
  handler: () => {
    throw new Error('Recovery-only flow tool cannot be called')
  },
}

/** The open request's `requests`: the latest entry, while the task awaits it. */
function outstandingInputRequests(record: TaskRecord): InputRecord['requests'] | undefined {
  const latest = record.inputs.at(-1)
  return record.status === 'input_required' && latest?.outcome === undefined
    ? latest?.requests
    : undefined
}

export function recoveryToolMap(tools: ToolDefinitions): ToolDefinitions {
  return new Proxy(tools, {
    get(target, name, receiver) {
      if (typeof name === 'string' && name.startsWith('flow_') && !Object.hasOwn(target, name)) {
        return recoveryOnlyTool
      }
      return Reflect.get(target, name, receiver)
    },
  })
}

export function createRecovery(params: {
  flows: ReadonlyMap<string, FlowDefinition>
  caller: ToolCaller
  predictor: Predictor | PredictorFactory
  elicitation: () => boolean
}): NonNullable<TaskManagerParams['recover']> {
  return async (record, resume) => {
    const data = record.resumeData as unknown as ResumeDataV1
    const siblings = (Array.isArray(data?.siblings) ? data.siblings : []).filter(
      (entry): entry is ResumeDataV1['siblings'][number] =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.tool === 'string' &&
        typeof entry.taskId === 'string',
    )
    const cleanup = async () => {
      await Promise.all(
        siblings.map(async ({ tool, taskId }) => {
          try {
            await cancelSibling(params.caller, { id: tool, taskId })
          } catch (error) {
            console.error('Flow sibling cancellation failed', error)
          }
        }),
      )
    }

    if (data?.v !== 1) {
      await resume(async () => {
        await cleanup()
        throw new RPCError({ code: -32603, message: 'Unsupported flow resume data version' })
      })
      return
    }
    const state = data.runState

    if (state.status === 'ended' || state.status === 'error' || state.status === 'aborted') {
      await resume(async (handle): Promise<CallToolResult> => {
        try {
          if (state.status === 'aborted') {
            await handle.cancel()
            return { content: [] }
          }
          const result = terminalResult(state)
          if (result === undefined) throw new Error('Invalid terminal checkpoint')
          return result
        } finally {
          await cleanup()
        }
      })
      return
    }

    let definition: FlowDefinition | undefined
    if ('definition' in data.flow) {
      definition = data.flow.definition
    } else {
      const registered = params.flows.get(data.flow.id)
      if (
        registered !== undefined &&
        digestDefinition(registered as unknown as JSONValue) === data.flow.digest
      )
        definition = registered
    }
    if (definition === undefined) {
      await resume(async () => {
        await cleanup()
        throw new RPCError({ code: -32603, message: 'Flow definition changed' })
      })
      return
    }

    const checked = checkFlow({
      definition,
      caller: params.caller,
      predictor: params.predictor,
      elicitation: params.elicitation(),
    })
    if (checked.issues) {
      await resume(async () => {
        await cleanup()
        throw new RPCError({
          code: -32603,
          message: 'Flow no longer valid',
          data: { formatted: checked.formatted },
        })
      })
      return
    }

    const graph = checked.graphFor({ depth: data.depth, approved: new Set(data.approved) })
    await resume((handle) => {
      const controller = new AbortController()
      const abort = () => controller.abort(handle.signal.reason)
      if (handle.signal.aborted) abort()
      else handle.signal.addEventListener('abort', abort, { once: true })
      // startRun re-enters a suspended wait before consuming this lazy run.
      const run =
        state.status === 'running'
          ? graph.recover({ definition, runState: state, signal: controller.signal })
          : graph.start({ definition, signal: controller.signal })
      return startRun({
        handle,
        graph,
        run,
        definition,
        resumeData: { ...data, siblings },
        caller: params.caller,
        outstandingInputRequests: outstandingInputRequests(record),
      }).finally(() => handle.signal.removeEventListener('abort', abort))
    })
  }
}
