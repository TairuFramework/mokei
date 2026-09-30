import type { JSONValue } from '@mokei/context-server'
import { createDecisionFlowGraph, type Predictor } from '@mokei/decision-flow'
import {
  type FlowDefinition,
  type FlowGraph,
  type FlowIssue,
  formatIssues,
} from '@sozai/flow-graph'

import { type PredictorFactory, resolvePredictor } from './predictor.js'
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

/** Check a definition against the current catalogue and return a fresh graph factory. */
export function checkFlow(params: {
  definition: unknown
  caller: ToolCaller
  predictor: Predictor | PredictorFactory
  elicitation: boolean
}): {
  ok: boolean
  issues: Array<FlowIssue>
  formatted: string
  graphFor(run: { depth: number; approved: ReadonlySet<string> }): FlowGraph
} {
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
    })
  const graph = graphFor({ depth: 0, approved: new Set() })
  const checked = graph.check(params.definition)
  const raw = params.definition
  const nodes = isObject(raw) && isObject(raw.nodes) ? raw.nodes : undefined
  const inputNodes =
    nodes !== undefined &&
    Object.values(nodes).some((node) => isObject(node) && node.kind === 'input')
  const issues = [
    ...checked.issues,
    ...(nodes !== undefined ? checkInputNodes(raw as FlowDefinition) : []),
    ...(!params.elicitation && inputNodes
      ? [
          {
            severity: 'warning' as const,
            code: 'input_without_elicitation',
            path: ['nodes'],
            message: 'Input nodes require elicitation.',
            hint: 'Enable elicitation before running this flow.',
          },
        ]
      : []),
  ]
  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    formatted: formatIssues(issues),
    graphFor,
  }
}
