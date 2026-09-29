import type { Predictor } from '@mokei/decision-flow'
import type { FlowDefinition } from '@sozai/flow-graph'

import type { PredictorFactory } from './predictor.js'

/** Tools a run may call, independent of which branches it takes. */
export function flowPlan(
  definition: FlowDefinition,
  predictor: Predictor | PredictorFactory,
): Array<string> {
  const tools = new Set<string>()
  let hasDecide = false
  for (const node of Object.values(definition.nodes)) {
    if (node.kind === 'tool' && typeof node.tool === 'string') tools.add(node.tool)
    if (node.kind === 'decide') hasDecide = true
  }
  if (hasDecide && typeof predictor === 'function') tools.add(predictor.tool)
  return [...tools].sort()
}
