import { type CallToolResult, MISSING_REQUIRED_CLIENT_CAPABILITY } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type {
  JSONValue,
  ServerConfig,
  TaskManager,
  TaskManagerParams,
  ToolDefinitions,
} from '@mokei/context-server'
import type { Predictor } from '@mokei/decision-flow'
import { digestDefinition, type FlowDefinition } from '@sozai/flow-graph'

import { MAX_FLOW_DEPTH, readFlowDepth } from './call-meta.js'
import { checkFlow } from './definition-checks.js'
import { type ResumeDataV1, startRun } from './driver.js'
import { flowInputSchema, flowSummaries, flowToolName } from './flow-tools.js'
import type { PredictorFactory } from './predictor.js'
import { createRecovery, recoveryToolMap } from './recovery.js'
import { createFlowRegistry, type FlowRegistry } from './registry.js'
import type { ToolCaller } from './tool-caller.js'

export type ApprovalHook = (params: {
  toolName: string
  arguments: Record<string, JSONValue>
  meta: Record<string, JSONValue>
}) => { tools: Array<string> } | undefined

export type DecisionFlowServerParams = {
  caller: ToolCaller
  predictor: Predictor | PredictorFactory
  tasks: TaskManager
  flows?: Array<FlowDefinition>
  /** Wins over `flows` when both are given. */
  registry?: FlowRegistry
  approval: ApprovalHook
  elicitation?: () => boolean
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

export async function createDecisionFlowServer(params: DecisionFlowServerParams): Promise<{
  config: Omit<ServerConfig, 'tasks'> & { tasks: TaskManager }
  tools: ToolDefinitions
  recoveryTools: ToolDefinitions
  recover: NonNullable<TaskManagerParams['recover']>
}> {
  const elicitation = params.elicitation ?? (() => false)
  const registry = params.registry ?? createFlowRegistry(params.flows ?? [])
  const tools: ToolDefinitions = {
    check_flow: {
      description: 'Check a decision flow definition',
      inputSchema: {
        type: 'object',
        properties: { definition: { type: 'object' } },
        required: ['definition'],
      },
      handler: async ({ input }) => {
        const checked = await checkFlow({
          definition: input.definition,
          registry,
          caller: params.caller,
          predictor: params.predictor,
          elicitation: elicitation(),
        })
        return {
          content: [{ type: 'text', text: checked.formatted }],
          structuredContent: {
            ok: checked.issues === undefined,
            issues: [...(checked.issues ?? []), ...checked.warnings],
            formatted: checked.formatted,
          },
        }
      },
    },
    list_flows: {
      description: 'List the registered decision flows',
      inputSchema: { type: 'object' },
      handler: () => {
        const flows = flowSummaries(registry)
        return {
          content: [
            {
              type: 'text',
              text: flows.map((flow) => `${flow.id} v${flow.version}: ${flow.name}`).join('\n'),
            },
          ],
          structuredContent: { flows },
        }
      },
    },
    run_flow: {
      description: 'Run a decision flow definition',
      inputSchema: {
        type: 'object',
        properties: { definition: { type: 'object' }, input: {} },
        required: ['definition'],
      },
      handler: (request) =>
        runFlow('run_flow', request.input.definition, request.input.input, request),
    },
  }

  type Request = Parameters<(typeof tools)['run_flow']['handler']>[0]

  async function runFlow(name: string, definition: unknown, input: unknown, request: Request) {
    const depth = readFlowDepth(request.meta)
    if (depth === undefined || depth >= MAX_FLOW_DEPTH) return errorResult('Invalid flow depth')
    const checked = await checkFlow({
      definition,
      registry,
      caller: params.caller,
      predictor: params.predictor,
      elicitation: elicitation(),
    })
    if (checked.issues) return errorResult(checked.formatted)
    const approved = params.approval({
      toolName: name,
      arguments: request.input as Record<string, JSONValue>,
      meta: request.meta,
    })
    if (
      approved === undefined ||
      !Array.isArray(approved.tools) ||
      !approved.tools.every((tool) => typeof tool === 'string')
    ) {
      return errorResult('Flow denied')
    }
    if (request.task === undefined) {
      throw new RPCError({
        code: MISSING_REQUIRED_CLIENT_CAPABILITY,
        message: 'Client did not declare the tasks extension',
      })
    }
    const flow = definition as FlowDefinition
    const graph = checked.graphFor({ depth, approved: new Set(approved.tools) })
    // The run starts before the task exists so its initial state is stored with the task;
    // the controller links it to the task handle's signal, which tasks/cancel aborts.
    const controller = new AbortController()
    const run = graph.start({
      definition: flow,
      input: input as JSONValue,
      signal: controller.signal,
    })
    const resumeData: ResumeDataV1 = {
      v: 1,
      flow:
        name === 'run_flow'
          ? { definition: flow }
          : { id: flow.id, digest: digestDefinition(flow as unknown as JSONValue) },
      approved: approved.tools,
      depth,
      runState: run.getState(),
      siblings: [],
    }
    return request.task.run(
      (handle) => {
        const abort = () => controller.abort(handle.signal.reason)
        if (handle.signal.aborted) abort()
        else handle.signal.addEventListener('abort', abort, { once: true })
        return startRun({
          handle,
          graph,
          run,
          resumeData,
          caller: params.caller,
          lookup: checked.lookup,
        }).finally(() => handle.signal.removeEventListener('abort', abort))
      },
      { resumeData: resumeData as unknown as JSONValue },
    )
  }

  for (const flow of registry.flows) {
    const name = flowToolName(flow.id)
    if (Object.hasOwn(tools, name)) throw new Error(`Flow tool name collision: ${name}`)
    const inputSchema = flowInputSchema(flow)
    const checked = await checkFlow({
      definition: flow,
      registry,
      caller: params.caller,
      predictor: params.predictor,
      elicitation: elicitation(),
    })
    if (checked.issues) throw new Error(`Invalid registered flow ${flow.id}: ${checked.formatted}`)
    tools[name] = {
      description: flow.name,
      inputSchema: inputSchema as ToolDefinitions[string]['inputSchema'],
      handler: (request) => runFlow(name, flow, request.input, request),
    }
  }

  const recover = createRecovery({
    registry,
    caller: params.caller,
    predictor: params.predictor,
    elicitation,
  })
  return {
    config: {
      name: 'decision-flow',
      version: '0.14.0',
      protocolVersions: ['2026-07-28'],
      tasks: params.tasks,
      tools,
    },
    tools,
    recoveryTools: recoveryToolMap(tools),
    recover,
  }
}
