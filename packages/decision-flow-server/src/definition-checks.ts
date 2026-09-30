import type { JSONValue } from '@mokei/context-server'
import { createDecisionFlowGraph, type Predictor } from '@mokei/decision-flow'
import {
  digestDefinition,
  type FlowDefinition,
  type FlowGraph,
  type FlowIssue,
  formatIssues,
} from '@sozai/flow-graph'
import type { StandardSchemaV1 } from '@standard-schema/spec'

import { type PredictorFactory, resolvePredictor } from './predictor.js'
import {
  definitionResolution,
  type FlowLookup,
  type FlowRegistry,
  reachableFlows,
} from './registry.js'
import type { ToolCaller } from './tool-caller.js'
import { toolKind } from './tool-node.js'

type JSONObject = Record<string, JSONValue>

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrimitiveSchema(schema: unknown): schema is JSONObject {
  if (!isObject(schema)) return false
  if (
    ['$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'items', 'properties', 'additionalProperties'].some(
      (key) => Object.hasOwn(schema, key),
    )
  )
    return false
  const type = schema.type
  const stringEnum =
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every((value) => typeof value === 'string')
  if (Object.hasOwn(schema, 'enum') && (!stringEnum || (type !== undefined && type !== 'string'))) {
    return false
  }
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'integer' ||
    type === 'boolean' ||
    (type === undefined && stringEnum)
  )
}

// MCP form elicitation requires an explicit type; a bare string enum becomes a string schema.
function toWirePrimitive(schema: JSONObject): JSONObject {
  return schema.type === undefined ? { type: 'string', ...schema } : schema
}

/** Adapt an input node schema to the flat MCP form schema. */
export function toElicitationSchema(
  schema: unknown,
): { requestedSchema: JSONObject; wrapped: boolean } | undefined {
  if (isPrimitiveSchema(schema)) {
    return {
      requestedSchema: {
        type: 'object',
        properties: { value: toWirePrimitive(schema) },
        required: ['value'],
      },
      wrapped: true,
    }
  }
  if (!isObject(schema) || schema.type !== 'object') return undefined
  if (schema.properties !== undefined && !isObject(schema.properties)) return undefined
  const properties = (schema.properties ?? {}) as Record<string, unknown>
  if (
    ['$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'items'].some((key) => Object.hasOwn(schema, key))
  ) {
    return undefined
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    return undefined
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      !schema.required.every((name) => typeof name === 'string' && Object.hasOwn(properties, name)))
  )
    return undefined
  if (!Object.values(properties).every(isPrimitiveSchema)) {
    return undefined
  }
  const wireProperties = Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [
      name,
      toWirePrimitive(property as JSONObject),
    ]),
  )
  return {
    requestedSchema: { ...(schema as JSONObject), properties: wireProperties },
    wrapped: false,
  }
}

/** Report input nodes that cannot be served through MCP form elicitation. */
export function checkInputNodes(definition: FlowDefinition): Array<FlowIssue> {
  const issues: Array<FlowIssue> = []
  for (const [id, node] of Object.entries(definition.nodes)) {
    if (!isObject(node) || node.kind !== 'input') continue
    if (toElicitationSchema(node.schema) === undefined) {
      issues.push({
        severity: 'error',
        code: 'input_schema_not_elicitable',
        path: ['nodes', id, 'schema'],
        message: 'Input schema cannot be used for form elicitation.',
        hint: 'Use a primitive, string enum, or flat object with primitive properties.',
      })
    }
    const prompt = node.prompt
    if (
      !isObject(prompt) ||
      (!('ref' in prompt) && (!Object.hasOwn(prompt, 'value') || typeof prompt.value !== 'string'))
    ) {
      issues.push({
        severity: 'error',
        code: 'input_prompt_not_string',
        path: ['nodes', id, 'prompt'],
        message: 'Input prompt must be a string.',
        hint: 'Use a constant string prompt or a reference that resolves to a string.',
      })
    }
  }
  return issues
}

/**
 * Standard Schema failure result whose issues are flow issues. `FlowIssue` extends
 * `StandardSchemaV1.Issue`, so this is assignable to `StandardSchemaV1.FailureResult`.
 */
export type FlowCheckFailure = { readonly issues: ReadonlyArray<FlowIssue> }

/**
 * Result of checking a flow definition: a Standard Schema result carrying the definition on
 * success, or the blocking issues on failure.
 */
export type FlowCheckResult = (
  | StandardSchemaV1.SuccessResult<FlowDefinition>
  | FlowCheckFailure
) & {
  /** Non-blocking issues, reported whether or not the check succeeds. */
  warnings: Array<FlowIssue>
  /** Every issue, blocking and non-blocking, formatted for display. */
  formatted: string
  graphFor(run: { depth: number; approved: ReadonlySet<string> }): FlowGraph
  /** Root-first lookup of the checked definition and the registered flows. */
  lookup: FlowLookup
}

/** Check a definition and the flows it references against the current catalogue. */
export async function checkFlow(params: {
  definition: unknown
  registry: FlowRegistry
  caller: ToolCaller
  predictor: Predictor | PredictorFactory
  elicitation: boolean
}): Promise<FlowCheckResult> {
  const raw = params.definition
  const id = isObject(raw) && typeof raw.id === 'string' ? raw.id : undefined
  const { lookup, resolver } =
    id === undefined
      ? params.registry
      : definitionResolution(raw as FlowDefinition, params.registry)
  const graphFor = (run: { depth: number; approved: ReadonlySet<string> }): FlowGraph =>
    createDecisionFlowGraph({
      client: resolvePredictor(params.predictor, run),
      kinds: [
        toolKind({
          caller: params.caller,
          catalogue: params.caller.listTools(),
          depth: run.depth,
          approved: run.approved,
        }),
      ],
      resolver,
    })

  const all: Array<FlowIssue> = []
  const registeredDigest = id === undefined ? undefined : params.registry.digest(id)
  if (registeredDigest !== undefined && registeredDigest !== digestDefinition(raw as never)) {
    all.push({
      severity: 'error',
      code: 'flow_id_conflict',
      path: ['id'],
      message: 'Flow id is already registered with a different definition.',
      hint: 'Use a different id or the registered definition.',
    })
  }
  const graph = graphFor({ depth: 0, approved: new Set() })
  const local = graph.check(raw)
  if (local.issues) {
    all.push(...local.issues)
  } else {
    const checked = await graph.checkFlows(raw)
    all.push(...(checked.issues ?? checked.warnings))
  }
  const reached = reachableFlows(raw, lookup, 'all')
  for (const [index, flow] of reached.entries()) {
    const issues = checkInputNodes(flow)
    all.push(
      ...(index === 0
        ? issues
        : issues.map((issue) => ({
            ...issue,
            path: ['flows', flow.id, flow.version, ...(issue.path ?? [])],
          }))),
    )
  }
  const inputNodes = reached.some((flow) =>
    Object.values(flow.nodes).some((node) => isObject(node) && node.kind === 'input'),
  )
  if (!params.elicitation && inputNodes) {
    all.push({
      severity: 'warning',
      code: 'input_without_elicitation',
      path: ['nodes'],
      message: 'Input nodes require elicitation.',
      hint: 'Enable elicitation before running this flow.',
    })
  }
  const errors = all.filter((issue) => issue.severity === 'error')
  const warnings = all.filter((issue) => issue.severity !== 'error')
  const details = { warnings, formatted: formatIssues(all), graphFor, lookup }
  return errors.length > 0
    ? { issues: errors, ...details }
    : { value: raw as FlowDefinition, ...details }
}
