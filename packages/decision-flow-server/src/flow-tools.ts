import type { FlowDefinition } from '@sozai/flow-graph'
import type { Schema } from '@sozai/schema'

import { type FlowRegistry, reachableFlows } from './registry.js'

export type FlowSummary = {
  id: string
  name: string
  version: number
  input: Schema
  outputs: Array<string>
  outcomes: Array<string>
}

export function flowToolName(id: string): string {
  return `flow_${id.replace(/[^A-Za-z0-9_]/g, '_')}`
}

export function flowInputSchema(definition: FlowDefinition): Schema {
  if (definition.input === undefined) return { type: 'object' }
  if (definition.input.type !== 'object') {
    throw new Error(`Flow ${definition.id} requires an object input schema`)
  }
  return definition.input
}

/** Registered flows sorted by id, with the outputs and outcomes a `call` can observe. */
export function flowSummaries(registry: FlowRegistry): Array<FlowSummary> {
  return registry.flows
    .map((flow) => {
      const outputs = new Set<string>()
      const outcomes = new Set<string>()
      for (const reached of reachableFlows(flow, registry.lookup, 'goto')) {
        for (const node of Object.values(reached.nodes)) {
          if (node.kind !== 'end') continue
          const end = node as { output?: Record<string, unknown>; outcome?: unknown }
          for (const key of Object.keys(end.output ?? {})) outputs.add(key)
          if (typeof end.outcome === 'string') outcomes.add(end.outcome)
        }
      }
      return {
        id: flow.id,
        name: flow.name,
        version: flow.version,
        input: structuredClone(flowInputSchema(flow)),
        outputs: [...outputs].sort(),
        outcomes: [...outcomes].sort(),
      }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
