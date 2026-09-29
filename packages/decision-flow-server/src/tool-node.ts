import type { CallToolResult } from '@mokei/context-protocol'
import { INTERNAL_ERROR } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type { JSONValue } from '@mokei/context-server'
import { decideNodeSchema } from '@mokei/decision-flow'
import {
  type CheckContext,
  type ExecuteContext,
  type Filter,
  type FlowIssue,
  type FlowRetryPolicy,
  type NodeKind,
  retryPolicySchema,
  type Value,
} from '@sozai/flow-graph'
import { createValidator, type Schema, type Validator } from '@sozai/schema'

import { callMeta } from './call-meta.js'
import type { CatalogTool, ToolCaller } from './tool-caller.js'
import { ToolNodeError } from './tool-errors.js'

export type ToolNode = {
  kind: 'tool'
  description?: string
  tool: string
  args: Record<string, Value>
  next?: string
  cases?: Array<{ when: Filter; to: string }>
  default?: string
  onError?: string
  retry?: FlowRetryPolicy
}

export type ToolSuspendData = { tool: string; taskId: string }

export type ToolResumeValue =
  | { ok: true; result: CallToolResult }
  | { ok: false; status: 'failed' | 'cancelled'; error?: JSONValue }

const definitions = decideNodeSchema.definitions
const unconstrainedResultSchema: Schema = { additionalProperties: {} }

export const toolNodeSchema: Schema = {
  definitions,
  type: 'object',
  properties: {
    kind: { const: 'tool' },
    description: { type: 'string' },
    tool: { type: 'string' },
    args: { type: 'object', additionalProperties: { $ref: '#/definitions/value' } },
    next: { type: 'string' },
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: { when: { $ref: '#/definitions/filter' }, to: { type: 'string' } },
        required: ['when', 'to'],
        additionalProperties: false,
      },
    },
    default: { type: 'string' },
    onError: { type: 'string' },
    retry: structuredClone(retryPolicySchema) as Schema,
  },
  required: ['kind', 'tool', 'args'],
  additionalProperties: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isConstant(value: Value): value is { value: JSONValue } {
  return isRecord(value) && Object.hasOwn(value, 'value')
}

function resultValue(
  result: CallToolResult,
  catalogued: CatalogTool,
  validator?: Validator<unknown>,
): JSONValue {
  if (result.isError === true)
    throw new ToolNodeError('tool_error', `Tool ${catalogued.id} returned an error`)
  if (catalogued.outputSchema !== undefined) {
    if (result.structuredContent === undefined || validator?.(result.structuredContent).issues) {
      throw new ToolNodeError(
        'tool_invalid_output',
        `Tool ${catalogued.id} returned invalid output`,
      )
    }
    return result.structuredContent as JSONValue
  }
  if (result.structuredContent !== undefined) return result.structuredContent as JSONValue
  const text = result.content
    .filter(
      (part): part is Extract<(typeof result.content)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('')
  try {
    return JSON.parse(text) as JSONValue
  } catch {
    return text
  }
}

function dispatchError(error: unknown): ToolNodeError {
  if (error instanceof ToolNodeError) return error
  if (error instanceof RPCError) {
    return error.code === INTERNAL_ERROR
      ? new ToolNodeError('tool_call_failed', error.message, true, error)
      : new ToolNodeError('tool_rejected', error.message, false, error)
  }
  if (isRecord(error) && error.code === 'tool_unavailable') {
    return new ToolNodeError('tool_unavailable', 'Tool unavailable', false, error)
  }
  return new ToolNodeError('tool_call_failed', 'Tool call failed', true, error)
}

function next(node: ToolNode, ctx: ExecuteContext) {
  if (node.next !== undefined) return node.next
  return node.cases?.find((item) => ctx.evaluate(item.when))?.to ?? node.default ?? ''
}

/** Create a tool kind bound to one run's catalogue, approval, and call depth. */
export function toolKind(params: {
  caller: ToolCaller
  catalogue: Array<CatalogTool>
  depth: number
  approved?: ReadonlySet<string>
}): NodeKind<ToolNode> {
  const catalogued = new Map(params.catalogue.map((entry) => [entry.id, entry]))
  const validatorCache = new Map<Schema, Validator<unknown>>()
  const validatorFor = (schema: Schema): Validator<unknown> => {
    let validator = validatorCache.get(schema)
    if (validator === undefined) {
      validator = createValidator(schema)
      validatorCache.set(schema, validator)
    }
    return validator
  }
  const inputValidators = new Map(
    params.catalogue.map((entry) => [entry.id, validatorFor(entry.inputSchema)]),
  )
  const mixedInputValidators = new Map(
    params.catalogue.map((entry) => [
      entry.id,
      validatorFor({ ...entry.inputSchema, required: [] }),
    ]),
  )
  const outputValidators = new Map(
    params.catalogue
      .filter((entry) => entry.outputSchema !== undefined)
      .map((entry) => [entry.id, validatorFor(entry.outputSchema as Schema)]),
  )

  function check(node: ToolNode, ctx: CheckContext): Array<FlowIssue> {
    const issues: Array<FlowIssue> = []
    const report = (code: string, path: Array<string | number>, message: string, hint: string) => {
      issues.push(ctx.issue({ code, path: ['nodes', ctx.nodeID, ...path], message, hint }))
    }
    const entry = catalogued.get(node.tool)
    if (entry === undefined) {
      report(
        'unknown_tool',
        ['tool'],
        `Unknown tool ${node.tool}.`,
        `Available tools: ${[...catalogued.keys()].join(', ') || '(none)'}.`,
      )
    } else {
      if (entry.outputSchema?.properties && Object.hasOwn(entry.outputSchema.properties, 'error')) {
        report(
          'tool_output_reserved_field',
          ['tool'],
          'Tool output schema declares reserved error field.',
          'Remove the top-level error property from the tool output schema.',
        )
      }
      const constantArgs = Object.entries(node.args).filter(([, value]) => isConstant(value))
      if (constantArgs.length === Object.keys(node.args).length) {
        const values = Object.fromEntries(
          constantArgs.map(([key, value]) => [key, (value as { value: JSONValue }).value]),
        )
        if (inputValidators.get(node.tool)?.(values).issues) {
          report(
            'tool_invalid_args',
            ['args'],
            'Constant arguments do not match the tool input schema.',
            'Use values that match the tool input schema.',
          )
        }
      } else {
        const values = Object.fromEntries(
          constantArgs.map(([key, value]) => [key, (value as { value: JSONValue }).value]),
        )
        if (mixedInputValidators.get(node.tool)?.(values).issues) {
          report(
            'tool_invalid_args',
            ['args'],
            'Constant arguments do not match the tool input schema.',
            'Use values that match the tool input schema.',
          )
        }
      }
    }
    const hasNext = node.next !== undefined
    const hasCases = node.cases !== undefined
    const hasDefault = node.default !== undefined
    if (hasNext === (hasCases && hasDefault) || hasCases !== hasDefault) {
      report(
        'tool_invalid_targets',
        [],
        'Tool node requires next or cases with default.',
        'Supply exactly one of next, or cases together with default.',
      )
    }
    return issues
  }

  function finish(node: ToolNode, ctx: ExecuteContext, result: CallToolResult) {
    const entry = catalogued.get(node.tool)
    if (entry === undefined)
      throw new ToolNodeError('tool_unavailable', `Tool unavailable: ${node.tool}`)
    ctx.setResult(resultValue(result, entry, outputValidators.get(node.tool)))
    return { next: next(node, ctx) }
  }

  return {
    kind: 'tool',
    schema: toolNodeSchema,
    targets: (node) => [
      ...(node.next === undefined ? [] : [{ path: ['next'], id: node.next }]),
      ...(node.cases ?? []).map((item, index) => ({ path: ['cases', index, 'to'], id: item.to })),
      ...(node.default === undefined ? [] : [{ path: ['default'], id: node.default }]),
      ...(node.onError === undefined ? [] : [{ path: ['onError'], id: node.onError }]),
    ],
    resultSchema: (node) => catalogued.get(node.tool)?.outputSchema ?? unconstrainedResultSchema,
    retries: true,
    check,
    describeError: (error) => ({
      type: error instanceof ToolNodeError ? error.code : 'tool_call_failed',
    }),
    retryable: (error) => error instanceof ToolNodeError && error.retryable,
    async execute(node, ctx) {
      const args = Object.fromEntries(
        Object.entries(node.args).map(([key, value]) => [key, ctx.resolve(value)]),
      )
      const entry = params.caller.listTools().find((tool) => tool.id === node.tool)
      if (entry === undefined)
        throw new ToolNodeError('tool_unavailable', `Tool unavailable: ${node.tool}`)
      const validate = validatorFor(entry.inputSchema)
      if (validate(args).issues)
        throw new ToolNodeError('tool_invalid_args', `Invalid arguments for ${node.tool}`)
      if (!params.approved?.has(node.tool))
        throw new ToolNodeError('tool_not_approved', `Tool not approved: ${node.tool}`)
      try {
        const outcome = await params.caller.callTool({
          id: node.tool,
          arguments: args,
          meta: callMeta({
            depth: params.depth + 1,
            key: `${ctx.runID}:${ctx.invocationID}`,
            attempt: ctx.attempt,
          }),
          signal: ctx.signal,
        })
        if ('task' in outcome)
          return {
            suspend: {
              data: { tool: node.tool, taskId: outcome.task.taskId } satisfies ToolSuspendData,
            },
          }
        return finish(node, ctx, outcome.result)
      } catch (error) {
        throw dispatchError(error)
      }
    },
    resume(node, ctx, event) {
      if (event.type === 'timeout')
        throw new ToolNodeError('tool_call_failed', 'Tool task timed out', true)
      const value = event.value as ToolResumeValue
      if (value.ok) return finish(node, ctx, value.result)
      throw value.status === 'cancelled'
        ? new ToolNodeError('tool_task_cancelled', 'Tool task cancelled')
        : new ToolNodeError('tool_task_failed', 'Tool task failed')
    },
  }
}
