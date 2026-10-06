import type {
  FlowCheckResult,
  FlowRunSnapshot,
  FlowSummary,
  InboxItem,
  Protocol,
  StoredLog,
  StoredSpan,
} from '@mokei/host-protocol'
import type { FromSchema } from '@sozai/schema'

export type { FlowCheckResult, FlowRunSnapshot, FlowSummary, InboxItem }

export type RunState = FlowRunSnapshot['state']

export type InboxOutcome = 'answered' | 'declined' | 'cancelled' | 'withdrawn'

export type RunTrace = { spans: Array<StoredSpan>; logs: Array<StoredLog> }

export type StartRunParams = FromSchema<Protocol['runs.start']['param']>

export type RunListFilter = FromSchema<Protocol['runs.list']['param']>

export type PromptAction = 'accept' | 'decline' | 'cancel'

export const TERMINAL_RUN_STATES: ReadonlyArray<RunState> = [
  'denied',
  'completed',
  'failed',
  'cancelled',
]

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state)
}

export type FlowEvent =
  | { type: 'run:state'; data: FlowRunSnapshot }
  | { type: 'inbox:added'; data: InboxItem }
  | { type: 'inbox:settled'; data: { item: InboxItem; outcome: InboxOutcome } }

export type FlowSubscription = AsyncIterable<FlowEvent> & { close(): void }

export type FlowControl = {
  flows: {
    list(): Promise<Array<FlowSummary>>
    check(definition: unknown): Promise<FlowCheckResult>
  }
  runs: {
    start(params: StartRunParams): Promise<FlowRunSnapshot>
    get(runID: string): Promise<FlowRunSnapshot>
    list(filter?: RunListFilter): Promise<Array<FlowRunSnapshot>>
    cancel(runID: string): Promise<FlowRunSnapshot>
    trace?(runID: string): Promise<RunTrace>
  }
  inbox: {
    list(filter?: { runID?: string }): Promise<Array<InboxItem>>
    get(id: string): Promise<InboxItem>
    answer(id: string, content?: Record<string, unknown>): Promise<void>
    decline(id: string, reason?: string): Promise<void>
    cancel(id: string): Promise<void>
    prompt?(id: string, signal?: AbortSignal): Promise<PromptAction>
  }
  subscribe(signal?: AbortSignal): Promise<FlowSubscription>
}

export type PendingItem =
  | {
      id: string
      kind: 'input'
      message: string
      requestedSchema: Record<string, unknown>
      canPrompt: boolean
    }
  | { id: string; kind: 'approval'; plan: { tools: Array<string> }; canPrompt: boolean }

export type RunStatus = {
  runID: string
  state: RunState
  pending: Array<PendingItem>
  result?: FlowRunSnapshot['result']
  error?: FlowRunSnapshot['error']
}
