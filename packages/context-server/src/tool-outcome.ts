import { type CallToolResult, INTERNAL_ERROR, inferSchemaDraft } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { createValidator, type Schema } from '@sozai/schema'

import { ToolOutputValidationError } from './definitions.js'
import type { GenericToolDefinition } from './types.js'

export type ToolOutcome = { result: CallToolResult } | { error: unknown }

export type SettledToolOutcome =
  | { result: CallToolResult }
  | { error: { code: number; message: string; data?: unknown } }

const outputValidators = new WeakMap<GenericToolDefinition, ReturnType<typeof createValidator>>()

export function settleToolOutcome(
  tool: GenericToolDefinition,
  outcome: ToolOutcome,
): SettledToolOutcome {
  if ('error' in outcome) {
    const cause = outcome.error
    if (cause instanceof RPCError) {
      return { error: { code: cause.code, message: cause.message, data: cause.data } }
    }
    const message = cause instanceof Error ? cause.message : String(cause)
    return { result: { content: [{ type: 'text', text: message }], isError: true } }
  }

  const result = outcome.result
  if (tool.outputSchema == null) {
    return { result }
  }

  const outputSchema = tool.outputSchema as Schema
  let validate = outputValidators.get(tool)
  if (validate == null) {
    validate = createValidator(outputSchema, {
      draft: inferSchemaDraft(outputSchema),
      strict: false,
    })
    outputValidators.set(tool, validate)
  }
  if (result.structuredContent == null) {
    const error = new ToolOutputValidationError({
      code: INTERNAL_ERROR,
      message: 'Invalid tool output',
      data: {
        issues: [{ message: 'Tool declares an outputSchema but returned no structuredContent' }],
      },
    })
    return settleToolOutcome(tool, { error })
  }
  const validated = validate(result.structuredContent)
  if (validated.issues != null) {
    const error = new ToolOutputValidationError({
      code: INTERNAL_ERROR,
      message: 'Invalid tool output',
      data: {
        issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
      },
    })
    return settleToolOutcome(tool, { error })
  }
  if (result.content == null) {
    return {
      result: {
        ...result,
        content: [{ type: 'text', text: JSON.stringify(result.structuredContent) }],
      },
    }
  }
  return { result }
}
