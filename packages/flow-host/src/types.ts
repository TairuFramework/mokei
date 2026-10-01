import type { CallToolResult } from '@mokei/context-protocol'
import type { JSONValue, TaskStore } from '@mokei/context-server'
import type { checkFlow, FlowSummary, PredictorFactory } from '@mokei/decision-flow-server'

export type { AuthorizeResult } from '@mokei/decision-flow-server'

import type { Predictor } from '@mokei/decision-flow'
import type { RequestedSchema } from '@mokei/host'
import type { Session } from '@mokei/session'
import type { EventEmitter } from '@sozai/event'
import type { FlowDefinition } from '@sozai/flow-graph'

import type { RunStore } from './run-store.js'

type ContentBlock = CallToolResult['content'][number]

export type RunState =
  | 'awaiting_approval'
  | 'denied'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type FlowRunSnapshot = {
  runID: string
  flowID?: string
  label: string
  state: RunState
  createdAt: number
  updatedAt: number
  traceID?: string
  plan: { tools: Array<string> }
  result?: { outcome?: string; output?: unknown; content: Array<ContentBlock> }
  error?: { type: string; message: string; code?: string }
}

export type InboxItem =
  | {
      id: string
      runID: string
      kind: 'approval'
      plan: { tools: Array<string> }
      createdAt: number
    }
  | {
      id: string
      runID: string
      kind: 'input'
      inputKey: string
      message: string
      requestedSchema: RequestedSchema
      createdAt: number
    }

export type InboxOutcome = 'answered' | 'declined' | 'cancelled' | 'withdrawn'

export type FlowHostEvents = {
  'run:state': FlowRunSnapshot
  'inbox:added': InboxItem
  'inbox:settled': { item: InboxItem; outcome: InboxOutcome }
}

export type FlowHostParams = {
  session: Session
  key?: string
  flows?: Array<FlowDefinition>
  predictor?: Predictor | PredictorFactory
  approval?: { allow?: Array<string> }
  runStore?: RunStore
  taskStore?: TaskStore
  pollMs?: number
}

export type FlowHost = {
  flows(): Array<FlowSummary>
  check(definition: unknown): ReturnType<typeof checkFlow>
  start(params: StartRunParams): Promise<FlowRunSnapshot>
  get(runID: string): Promise<FlowRunSnapshot | undefined>
  list(filter?: { states?: Array<RunState>; limit?: number }): Promise<Array<FlowRunSnapshot>>
  cancel(runID: string): Promise<FlowRunSnapshot>
  inbox: {
    list(filter?: { runID?: string }): Array<InboxItem>
    get(id: string): InboxItem | undefined
    answer(id: string, content?: Record<string, unknown>): Promise<void>
    decline(id: string, reason?: string): Promise<void>
    cancel(id: string): Promise<void>
  }
  events: EventEmitter<FlowHostEvents>
  dispose(): Promise<void>
}

export type StartRunParams =
  | { flow: string; input?: Record<string, unknown>; label?: string }
  | { definition: FlowDefinition; input?: Record<string, unknown>; label?: string }

export type RunRecord = FlowRunSnapshot & {
  revision: number
  request: { toolName: string; arguments: Record<string, JSONValue> }
  digest?: string
  taskID?: string
  traceparent?: string
  cancelRequested?: boolean
}
