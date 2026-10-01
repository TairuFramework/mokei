import { createTaskManager, type JSONValue, type TaskStore } from '@mokei/context-server'
import type { Predictor } from '@mokei/decision-flow'
import type { ContextHost, ContextTool } from '@mokei/host'
import type {
  Session,
  ToolApprovalFn,
  ToolApprovalRequest,
  ToolApprovalStrategy,
} from '@mokei/session'
import { type FlowDefinition, formatIssues } from '@sozai/flow-graph'

import { FLOW_GRANT_META } from './call-meta.js'
import { checkFlow, type FlowCheckResult } from './definition-checks.js'
import { flowToolName } from './flow-tools.js'
import { createGrantStore } from './grants.js'
import { flowPlan } from './plan.js'
import { createMCPPredictor, type PredictorFactory } from './predictor.js'
import { createFlowRegistry, reachableFlows } from './registry.js'
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
  taskTTLMs?: number | null
}

/** Flow details are present for checked flow runs and absent for other tool calls. */
export type FlowApprovalRequest = ToolApprovalRequest & {
  flow?: { id?: string; name: string; inline: boolean; tools: Array<string> }
}

export type FlowApprovalStrategy =
  | 'auto'
  | 'ask'
  | 'never'
  | ((request: FlowApprovalRequest) => ReturnType<ToolApprovalFn>)

export type DecisionFlowWiring = {
  authorize(request: {
    toolName: string
    arguments: Record<string, JSONValue>
  }): Promise<AuthorizeResult>
  check(definition: unknown): Promise<FlowCheckResult>
  /** Always returns a function, so AgentSession emits tool-call-pending before every tool call, including for 'auto'. */
  wrapApproval(strategy: FlowApprovalStrategy): ToolApprovalStrategy
  dispose(): Promise<void>
}

export type AuthorizeResult =
  | { ok: true; plan: Array<string>; digest?: string; grant(): Record<string, JSONValue> }
  | { ok: false; issues: Array<string> }

const pendingKeys = new WeakMap<ContextHost, Set<string>>()

function decision(result: Awaited<ReturnType<ToolApprovalFn>>): boolean {
  return typeof result === 'boolean' ? result : result.approved
}

function applyStrategy(
  strategy: FlowApprovalStrategy,
  request: FlowApprovalRequest,
): Promise<Awaited<ReturnType<ToolApprovalFn>>> {
  if (strategy === 'auto') return Promise.resolve(true)
  if (strategy === 'never') {
    return Promise.resolve({ approved: false, reason: 'Tool execution disabled' })
  }
  if (strategy === 'ask') {
    return Promise.resolve({
      approved: false,
      reason: 'Tool approval required but no handler configured',
    })
  }
  return strategy(request)
}

/** Attach a decision-flow MCP context and its one-call approval bridge to a session. */
export async function addDecisionFlow(
  session: Session,
  params: AddDecisionFlowParams,
): Promise<DecisionFlowWiring> {
  const host = session.contextHost
  const caller = hostToolCaller(host, { exclude: [params.key] })
  const predictor = params.predictor ?? createMCPPredictor(caller)
  const registry = createFlowRegistry(params.flows ?? [])
  const registered = new Map(registry.flows.map((flow) => [flowToolName(flow.id), flow]))

  for (const flow of registry.flows) {
    if (
      !host.elicitationEnabled &&
      reachableFlows(flow, registry.lookup, 'all').some((reached) =>
        Object.values(reached.nodes).some(
          (node) => typeof node === 'object' && node !== null && node.kind === 'input',
        ),
      )
    ) {
      throw new Error(`Registered flow ${flow.id} requires elicitation`)
    }
    const checked = await checkFlow({
      definition: flow,
      registry,
      caller,
      predictor,
      elicitation: host.elicitationEnabled,
    })
    if (checked.issues) throw new Error(`Invalid registered flow ${flow.id}: ${checked.formatted}`)
  }

  let reserved = pendingKeys.get(host)
  if (reserved === undefined) {
    reserved = new Set()
    pendingKeys.set(host, reserved)
  }
  if (reserved.has(params.key) || host.getContextKeys().includes(params.key)) {
    throw new Error(`Context ${params.key} already exists`)
  }
  reserved.add(params.key)
  const grants = createGrantStore()
  let tasks: ReturnType<typeof createTaskManager> | undefined
  let server: Awaited<ReturnType<typeof createDecisionFlowServer>> | undefined
  let registrationAttempted = false
  markDecisionFlowContext(host, params.key)
  try {
    tasks = createTaskManager({
      store: params.store,
      ttlMs: params.taskTTLMs,
      recover: (record, resume) => {
        if (server === undefined) throw new Error('Flow server unavailable during recovery')
        return server.recover(record, resume)
      },
    })
    server = await createDecisionFlowServer({
      caller,
      predictor,
      tasks,
      registry,
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
    if (host.getContextKeys().includes(params.key)) {
      throw new Error(`Context ${params.key} already exists`)
    }
    registrationAttempted = true
    host.addDirectContext({
      key: params.key,
      config: server.config,
      protocolVersion: '2026-07-28',
      tools,
    })
    reserved.delete(params.key)
  } catch (error) {
    await Promise.allSettled([
      registrationAttempted ? Promise.resolve().then(() => host.remove(params.key)) : undefined,
      Promise.resolve().then(() => tasks?.dispose()),
    ])
    reserved.delete(params.key)
    unmarkDecisionFlowContext(host, params.key)
    throw error
  }

  function check(definition: unknown): Promise<FlowCheckResult> {
    return checkFlow({
      definition,
      registry,
      caller,
      predictor,
      elicitation: host.elicitationEnabled,
    })
  }

  async function authorize(request: {
    toolName: string
    arguments: Record<string, JSONValue>
  }): Promise<AuthorizeResult> {
    const { toolName } = request
    const flow = registered.get(toolName)
    if (toolName !== 'run_flow' && flow === undefined) {
      return { ok: false, issues: [`Unknown flow tool: ${toolName}`] }
    }
    const args = structuredClone(request.arguments)
    const checked = await check(flow ?? args.definition)
    if (checked.issues) {
      return { ok: false, issues: checked.issues.map((issue) => formatIssues([issue])) }
    }
    const planned = flowPlan(checked.value, predictor, checked.lookup)
    return {
      ok: true,
      plan: [...planned],
      digest: flow === undefined ? undefined : registry.digest(flow.id),
      grant: () => ({
        [FLOW_GRANT_META]: grants.issue({ toolName, arguments: args, tools: planned }),
      }),
    }
  }

  let disposed = false
  return {
    authorize,
    check,
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
        const authorised = await authorize({ toolName: toolName as string, arguments: args })
        if (!authorised.ok) return true
        const enriched = {
          ...request,
          flow: {
            id: (definition as FlowDefinition).id,
            name: (definition as FlowDefinition).name,
            inline: flow === undefined,
            tools: authorised.plan,
          },
        }
        const result = await applyStrategy(strategy, enriched)
        if (!decision(result)) return result
        return {
          approved: true,
          meta: {
            ...(typeof result === 'boolean' ? {} : result.meta),
            ...authorised.grant(),
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
