import type { CallToolResult } from '@mokei/context-protocol'
import type { ContextTool } from '@mokei/host'
import type { FunctionToolCall, ModelProvider, ProviderTypes } from '@mokei/model-provider'

import type { Session } from './session.js'

/**
 * Tool approval strategy for agent execution.
 *
 * - `'auto'` - Execute all tools automatically without prompting
 * - `'ask'` - Emit a pending event and wait for external approval
 * - `'never'` - Never execute tools (dry run mode)
 * - `ToolApprovalFn` - Custom function to determine approval
 */
export type ToolApprovalStrategy = 'auto' | 'ask' | 'never' | ToolApprovalFn

/**
 * Custom function for tool approval decisions.
 *
 * @param toolCall - The tool call to approve or deny
 * @param context - Context about the current agent execution
 * @returns Promise resolving to approval decision
 */
export type ToolApprovalFn = (
  toolCall: FunctionToolCall<unknown>,
  context: ToolApprovalContext,
) => Promise<boolean | ToolApprovalDecision>

/**
 * Context provided to custom tool approval functions.
 */
export type ToolApprovalContext = {
  /** Current iteration number (1-based) */
  iteration: number
  /** History of events so far in this execution */
  history: Array<AgentEvent>
  /** The tool definition from the host */
  tool?: ContextTool
}

/**
 * Detailed approval decision with optional reason.
 */
export type ToolApprovalDecision = {
  approved: boolean
  reason?: string
}

/**
 * Parameters for creating an AgentSession.
 */
export type AgentParams<T extends ProviderTypes = ProviderTypes> = {
  /** Session instance managing providers and MCP connections */
  session: Session<T>
  /** Provider key (string to lookup from session) or ModelProvider instance */
  provider: string | ModelProvider<T>
  /** Model identifier to use for chat completions */
  model: string
  /** Optional system prompt prepended to messages */
  systemPrompt?: string
  /** Tool approval strategy (default: 'auto') */
  toolApproval?: ToolApprovalStrategy
  /** Maximum iterations before stopping (default: 10) */
  maxIterations?: number
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number
  /** Optional callback for each event during execution */
  onEvent?: (event: AgentEvent) => void
}

/**
 * Internal resolved params with all defaults applied.
 */
export type ResolvedAgentParams<T extends ProviderTypes = ProviderTypes> = {
  session: Session<T>
  provider: ModelProvider<T>
  model: string
  systemPrompt: string | undefined
  toolApproval: ToolApprovalStrategy
  maxIterations: number
  timeout: number
  onEvent: ((event: AgentEvent) => void) | undefined
}

/**
 * Union type of all events emitted during agent execution.
 */
export type AgentEvent =
  | AgentStartEvent
  | AgentIterationStartEvent
  | AgentTextDeltaEvent
  | AgentTextCompleteEvent
  | AgentToolCallPendingEvent
  | AgentToolCallApprovedEvent
  | AgentToolCallDeniedEvent
  | AgentToolCallStartEvent
  | AgentToolCallCompleteEvent
  | AgentToolCallErrorEvent
  | AgentIterationCompleteEvent
  | AgentCompleteEvent
  | AgentErrorEvent
  | AgentTimeoutEvent
  | AgentMaxIterationsEvent

/**
 * Emitted when the agent starts execution.
 */
export type AgentStartEvent = {
  type: 'start'
  prompt: string
  timestamp: number
}

/**
 * Emitted at the beginning of each iteration.
 */
export type AgentIterationStartEvent = {
  type: 'iteration-start'
  iteration: number
  timestamp: number
}

/**
 * Emitted for each text chunk streamed from the model.
 */
export type AgentTextDeltaEvent = {
  type: 'text-delta'
  text: string
  timestamp: number
}

/**
 * Emitted when text generation for an iteration completes.
 */
export type AgentTextCompleteEvent = {
  type: 'text-complete'
  text: string
  timestamp: number
}

/**
 * Emitted when a tool call is pending approval.
 * Only emitted when toolApproval is 'ask'.
 */
export type AgentToolCallPendingEvent = {
  type: 'tool-call-pending'
  toolCall: FunctionToolCall<unknown>
  timestamp: number
}

/**
 * Emitted when a tool call is approved.
 */
export type AgentToolCallApprovedEvent = {
  type: 'tool-call-approved'
  toolCall: FunctionToolCall<unknown>
  timestamp: number
}

/**
 * Emitted when a tool call is denied.
 */
export type AgentToolCallDeniedEvent = {
  type: 'tool-call-denied'
  toolCall: FunctionToolCall<unknown>
  reason?: string
  timestamp: number
}

/**
 * Emitted when tool execution begins.
 */
export type AgentToolCallStartEvent = {
  type: 'tool-call-start'
  toolCall: FunctionToolCall<unknown>
  timestamp: number
}

/**
 * Emitted when tool execution completes successfully.
 */
export type AgentToolCallCompleteEvent = {
  type: 'tool-call-complete'
  toolCall: FunctionToolCall<unknown>
  result: CallToolResult
  timestamp: number
}

/**
 * Emitted when tool execution fails.
 */
export type AgentToolCallErrorEvent = {
  type: 'tool-call-error'
  toolCall: FunctionToolCall<unknown>
  error: Error
  timestamp: number
}

/**
 * Emitted at the end of each iteration.
 */
export type AgentIterationCompleteEvent = {
  type: 'iteration-complete'
  iteration: number
  hasToolCalls: boolean
  timestamp: number
}

/**
 * Emitted when the agent completes successfully.
 */
export type AgentCompleteEvent = {
  type: 'complete'
  result: AgentResult
  timestamp: number
}

/**
 * Emitted when an error occurs during execution.
 */
export type AgentErrorEvent = {
  type: 'error'
  error: Error
  timestamp: number
}

/**
 * Emitted when execution times out.
 */
export type AgentTimeoutEvent = {
  type: 'timeout'
  timestamp: number
}

/**
 * Emitted when max iterations is reached.
 */
export type AgentMaxIterationsEvent = {
  type: 'max-iterations'
  iteration: number
  timestamp: number
}

/**
 * Final result of agent execution.
 */
export type AgentResult = {
  /** Final text response from the agent */
  text: string
  /** Total number of iterations executed */
  iterations: number
  /** All tool calls made during execution */
  toolCalls: Array<AgentToolCallRecord>
  /** Total input tokens used */
  inputTokens: number
  /** Total output tokens generated */
  outputTokens: number
  /** Total execution duration in milliseconds */
  duration: number
  /** How the agent completed: 'complete', 'max-iterations', 'timeout', 'aborted' */
  finishReason: AgentFinishReason
}

/**
 * Record of a single tool call during agent execution.
 */
export type AgentToolCallRecord = {
  /** The tool call that was made */
  call: FunctionToolCall<unknown>
  /** The result from tool execution, if approved and executed */
  result?: CallToolResult
  /** Whether the tool call was approved */
  approved: boolean
  /** Reason for denial, if not approved */
  denialReason?: string
  /** Error that occurred during execution, if any */
  error?: Error
}

/**
 * Reason the agent finished execution.
 */
export type AgentFinishReason = 'complete' | 'max-iterations' | 'timeout' | 'aborted' | 'error'

/**
 * Default values for agent parameters.
 */
export const AGENT_DEFAULTS = {
  maxIterations: 10,
  timeout: 5 * 60 * 1000, // 5 minutes
  toolApproval: 'auto' as const,
} as const
