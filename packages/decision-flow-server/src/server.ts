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
import { flowInputSchema, flowToolName } from './flow-tools.js'
import type { PredictorFactory } from './predictor.js'
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
  approval: ApprovalHook
  elicitation?: () => boolean
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

export function createDecisionFlowServer(params: DecisionFlowServerParams): {
  config: Omit<ServerConfig, 'tasks'> & { tasks: TaskManager }
  tools: ToolDefinitions
  recoveryTools: ToolDefinitions
  recover: NonNullable<TaskManagerParams['recover']>
} {
  const elicitation = params.elicitation ?? (() => false)
  const tools: ToolDefinitions = {
    check_flow: {
      description: 'Check a decision flow definition',
      inputSchema: {
        type: 'object',
        properties: { definition: { type: 'object' } },
        required: ['definition'],
      },
      handler: ({ input }) => {
        const checked = checkFlow({
          definition: input.definition,
          caller: params.caller,
          predictor: params.predictor,
          elicitation: elicitation(),
        })
        return {
          content: [{ type: 'text', text: checked.formatted }],
          structuredContent: {
            ok: checked.ok,
            issues: checked.issues,
            formatted: checked.formatted,
          },
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

  function runFlow(name: string, definition: unknown, input: unknown, request: Request) {
    const depth = readFlowDepth(request.meta)
    if (depth === undefined || depth >= MAX_FLOW_DEPTH) return errorResult('Invalid flow depth')
    const checked = checkFlow({
      definition,
      caller: params.caller,
      predictor: params.predictor,
      elicitation: elicitation(),
    })
    if (!checked.ok) return errorResult(checked.formatted)
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
    const run = graph.start({ definition: flow, input: input as JSONValue, signal: request.signal })
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
      (handle) => startRun({ handle, graph, run, resumeData, caller: params.caller }),
      { resumeData: resumeData as unknown as JSONValue },
    )
  }

  for (const flow of params.flows ?? []) {
    const name = flowToolName(flow.id)
    if (Object.hasOwn(tools, name)) throw new Error(`Flow tool name collision: ${name}`)
    const inputSchema = flowInputSchema(flow)
    const checked = checkFlow({
      definition: flow,
      caller: params.caller,
      predictor: params.predictor,
      elicitation: elicitation(),
    })
    if (!checked.ok) throw new Error(`Invalid registered flow ${flow.id}: ${checked.formatted}`)
    tools[name] = {
      description: flow.name,
      inputSchema: inputSchema as ToolDefinitions[string]['inputSchema'],
      handler: (request) => runFlow(name, flow, request.input, request),
    }
  }

  const recover: NonNullable<TaskManagerParams['recover']> = () => {
    throw new Error('not implemented')
  }
  return {
    config: {
      name: 'decision-flow',
      version: '0.14.0',
      protocolVersions: ['2026-07-28'],
      tasks: params.tasks,
      tools,
    },
    tools,
    recoveryTools: tools,
    recover,
  }
}
