import type { FlowDefinition } from '@sozai/flow-graph'
import type { Schema } from '@sozai/schema'

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
