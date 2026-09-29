import { type CallToolResult, INTERNAL_ERROR, inferSchemaDraft } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { createValidator, type Schema } from '@sozai/schema'

import { ToolInputValidationError, ToolOutputValidationError } from './definitions.js'
import type { GenericToolDefinition } from './types.js'

export type ToolOutcome = { result: CallToolResult } | { error: unknown }

export type SettledToolOutcome =
  | { result: CallToolResult }
  | { error: { code: number; message: string; data?: unknown } }

const outputValidators = new WeakMap<GenericToolDefinition, ReturnType<typeof createValidator>>()

export function finalizeToolResult(
  tool: GenericToolDefinition,
  result: CallToolResult,
): CallToolResult {
  if (tool.outputSchema == null) {
    return result
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
    throw new ToolOutputValidationError({
      code: INTERNAL_ERROR,
      message: 'Invalid tool output',
      data: {
        issues: [{ message: 'Tool declares an outputSchema but returned no structuredContent' }],
      },
    })
  }
  const validated = validate(result.structuredContent)
  if (validated.issues != null) {
    throw new ToolOutputValidationError({
      code: INTERNAL_ERROR,
      message: 'Invalid tool output',
      data: {
        issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
      },
    })
  }
  if (result.content == null) {
    return {
      ...result,
      content: [{ type: 'text', text: JSON.stringify(result.structuredContent) }],
    }
  }
  return result
}

export function settleToolOutcome(
  tool: GenericToolDefinition,
  outcome: ToolOutcome,
): SettledToolOutcome {
  if ('error' in outcome) {
    const cause = outcome.error
    if (cause instanceof ToolInputValidationError) {
      return { result: { content: [{ type: 'text', text: cause.message }], isError: true } }
    }
    if (cause instanceof RPCError) {
      return { error: { code: cause.code, message: cause.message, data: cause.data } }
    }
    const message = cause instanceof Error ? cause.message : String(cause)
    return { result: { content: [{ type: 'text', text: message }], isError: true } }
  }

  try {
    return { result: finalizeToolResult(tool, outcome.result) }
  } catch (error) {
    if (error instanceof ToolOutputValidationError) {
      return settleToolOutcome(tool, { error })
    }
    throw error
  }
}
