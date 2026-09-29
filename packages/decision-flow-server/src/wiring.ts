import { createTaskManager, type JSONValue, type TaskStore } from '@mokei/context-server'
import type { Predictor } from '@mokei/decision-flow'
import type { ContextTool } from '@mokei/host'
import type {
  Session,
  ToolApprovalFn,
  ToolApprovalRequest,
  ToolApprovalStrategy,
} from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'

import { FLOW_GRANT_META } from './call-meta.js'
import { checkFlow } from './definition-checks.js'
import { flowToolName } from './flow-tools.js'
import { createGrantStore } from './grants.js'
import { flowPlan } from './plan.js'
import { createMCPPredictor, type PredictorFactory } from './predictor.js'
import { createDecisionFlowServer } from './server.js'
import {
  hostToolCaller,
  markDecisionFlowContext,
  unmarkDecisionFlowContext,
} from './tool-caller.js'

export type AddDecisionFlowParams = {
  key: string
  flows?: Array<FlowDefinition>
  predictor?: Predictor | PredictorFactory
  store?: TaskStore
}

export type DecisionFlowWiring = {
  wrapApproval(strategy: ToolApprovalStrategy): ToolApprovalStrategy
  dispose(): Promise<void>
}

function decision(result: Awaited<ReturnType<ToolApprovalFn>>): boolean {
  return typeof result === 'boolean' ? result : result.approved
}

function applyStrategy(
  strategy: ToolApprovalStrategy,
  request: ToolApprovalRequest,
): Promise<Awaited<ReturnType<ToolApprovalFn>>> {
  if (strategy === 'auto') return Promise.resolve(true)
  if (strategy === 'never' || strategy === 'ask') return Promise.resolve(false)
  return strategy(request)
}

/** Attach a decision-flow MCP context and its one-call approval bridge to a session. */
export async function addDecisionFlow(
  session: Session,
  params: AddDecisionFlowParams,
): Promise<DecisionFlowWiring> {
  const host = session.contextHost
  const flows = params.flows ?? []
  const caller = hostToolCaller(host, { exclude: [params.key] })
  const predictor = params.predictor ?? createMCPPredictor(caller)
  const registered = new Map(flows.map((flow) => [flowToolName(flow.id), flow]))

  for (const flow of flows) {
    if (
      !host.elicitationEnabled &&
      Object.values(flow.nodes).some((node) => node.kind === 'input')
    ) {
      throw new Error(`Registered flow ${flow.id} requires elicitation`)
    }
    const checked = checkFlow({
      definition: flow,
      caller,
      predictor,
      elicitation: host.elicitationEnabled,
    })
    if (!checked.ok) throw new Error(`Invalid registered flow ${flow.id}: ${checked.formatted}`)
  }

  if (host.getContextKeys().includes(params.key)) {
    throw new Error(`Context ${params.key} already exists`)
  }
  const grants = createGrantStore()
  let tasks: ReturnType<typeof createTaskManager> | undefined
  let server: ReturnType<typeof createDecisionFlowServer> | undefined
  markDecisionFlowContext(host, params.key)
  try {
    tasks = createTaskManager({
      store: params.store,
      recover: (record, resume) => {
        if (server === undefined) throw new Error('Flow server unavailable during recovery')
        return server.recover(record, resume)
      },
    })
    server = createDecisionFlowServer({
      caller,
      predictor,
      tasks,
      flows,
      elicitation: () => host.elicitationEnabled,
      approval: ({ toolName, arguments: args, meta }) =>
        grants.consume({ token: meta[FLOW_GRANT_META], toolName, arguments: args }),
    })
    await tasks.recover(server.recoveryTools)
    const tools: Array<ContextTool> = Object.entries(server.tools).map(([name, definition]) => ({
      id: `${params.key}:${name}`,
      tool: {
        name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
      },
      enabled: true,
    }))
    host.addDirectContext({
      key: params.key,
      config: server.config,
      protocolVersion: '2026-07-28',
      tools,
    })
  } catch (error) {
    await host.remove(params.key)
    unmarkDecisionFlowContext(host, params.key)
    await tasks?.dispose()
    throw error
  }

  let disposed = false
  return {
    wrapApproval(strategy) {
      return async (request) => {
        const prefix = `${params.key}:`
        const name = request.toolCall.name
        const toolName = name.startsWith(prefix) ? name.slice(prefix.length) : undefined
        const flow = toolName === 'run_flow' ? undefined : registered.get(toolName ?? '')
        if (toolName !== 'run_flow' && flow === undefined) {
          return applyStrategy(strategy, request)
        }

        let args: Record<string, JSONValue>
        try {
          const parsed: unknown = JSON.parse(request.toolCall.arguments)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
          args = parsed as Record<string, JSONValue>
        } catch {
          return false
        }
        const definition = flow ?? args.definition
        const checked = checkFlow({
          definition,
          caller,
          predictor,
          elicitation: host.elicitationEnabled,
        })
        if (!checked.ok) return false
        const planned = flowPlan(definition as FlowDefinition, predictor)
        const enriched = {
          ...request,
          flow: {
            id: (definition as FlowDefinition).id,
            name: (definition as FlowDefinition).name,
            inline: flow === undefined,
            tools: planned,
          },
        }
        const result = await applyStrategy(strategy, enriched)
        if (!decision(result)) return result
        const token = grants.issue({
          toolName: toolName as string,
          arguments: args,
          tools: planned,
        })
        return {
          approved: true,
          meta: {
            ...(typeof result === 'boolean' ? {} : result.meta),
            [FLOW_GRANT_META]: token,
          },
        }
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      try {
        await host.remove(params.key)
      } finally {
        unmarkDecisionFlowContext(host, params.key)
        await tasks?.dispose()
      }
    },
  }
}
