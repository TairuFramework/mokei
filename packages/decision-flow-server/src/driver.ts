import type { CallToolResult } from '@mokei/context-protocol'
import type { TaskHandle } from '@mokei/context-server'
import type { FlowDefinition, FlowGraph, FlowRun, RunState } from '@sozai/flow-graph'

import type { ToolCaller } from './tool-caller.js'

export type ResumeDataV1 = {
  v: 1
  flow: { definition: FlowDefinition } | { id: string; digest: string }
  approved: Array<string>
  depth: number
  runState: RunState
  siblings: Array<{ tool: string; taskId: string }>
  inputSeq?: number
}

export async function startRun(_params: {
  handle: TaskHandle
  graph: FlowGraph
  run: FlowRun
  resumeData: ResumeDataV1
  caller: ToolCaller
}): Promise<CallToolResult> {
  throw new Error('not implemented')
}
