import {
  type CallToolResult,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  inferSchemaDraft,
  type InputSchema as ToolInputSchema,
  type OutputSchema as ToolOutputSchema,
} from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { createValidator, type FromSchema, type Schema } from '@sozai/schema'

/**
 * A tool handler's `structuredContent` violated (or was absent against) its
 * declared `outputSchema`. This is the server author's own contract breach, not
 * a tool telling the model it failed, so `ContextServer` lets it cross the wire
 * as a JSON-RPC error rather than converting it to an `isError` result.
 */
export class ToolOutputValidationError extends RPCError {}

import type {
  GenericPromptDefinition,
  GenericToolDefinition,
  HandlerRequest,
  PromptHandlerReturn,
  ResourceDefinitions,
  ResourceHandlers,
  TypedPromptHandler,
  TypedToolHandler,
} from './types.js'

export type CreatePromptParams<
  ArgumentsSchema extends Schema,
  Arguments = FromSchema<ArgumentsSchema>,
> = {
  description: string
  argumentsSchema?: ArgumentsSchema
  handler: TypedPromptHandler<Arguments>
}

export function createPrompt<
  ArgumentsSchema extends Schema,
  Arguments = FromSchema<ArgumentsSchema>,
>(params: CreatePromptParams<ArgumentsSchema, Arguments>): GenericPromptDefinition {
  const { description, argumentsSchema, handler } = params

  if (argumentsSchema == null) {
    const passthrough = (request: HandlerRequest<{ arguments: unknown }>): PromptHandlerReturn => {
      return handler({
        arguments: request.arguments as Arguments,
        client: request.client,
        signal: request.signal,
      })
    }
    return { description, handler: passthrough }
  }

  const validate = createValidator<ArgumentsSchema, Arguments>(argumentsSchema, {
    draft: inferSchemaDraft(argumentsSchema),
    strict: false,
  })

  const wrappedHandler = (request: HandlerRequest<{ arguments: unknown }>): PromptHandlerReturn => {
    const validated = validate(request.arguments)
    if (validated.issues == null) {
      return handler({ arguments: validated.value, client: request.client, signal: request.signal })
    }
    throw new RPCError(INVALID_PARAMS, 'Invalid prompt arguments', {
      issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return { description, argumentsSchema, handler: wrappedHandler }
}

export type CreateToolParams<
  InputSchema extends Schema,
  OutputSchema extends Schema | undefined = undefined,
  Arguments = FromSchema<InputSchema>,
  Output = OutputSchema extends Schema ? FromSchema<OutputSchema> : unknown,
> = {
  description: string
  inputSchema: InputSchema
  outputSchema?: OutputSchema
  handler: TypedToolHandler<Arguments, Output>
}

export function createTool<
  InputSchema extends Schema,
  OutputSchema extends Schema | undefined = undefined,
  Arguments = FromSchema<InputSchema>,
  Output = OutputSchema extends Schema ? FromSchema<OutputSchema> : unknown,
>(params: CreateToolParams<InputSchema, OutputSchema, Arguments, Output>): GenericToolDefinition {
  const { description, inputSchema, outputSchema, handler } = params

  const validateInput = createValidator<InputSchema, Arguments>(inputSchema, {
    draft: inferSchemaDraft(inputSchema),
    strict: false,
  })
  const validateOutput =
    outputSchema == null
      ? undefined
      : createValidator(outputSchema as Schema, {
          draft: inferSchemaDraft(outputSchema as Schema),
          strict: false,
        })

  const finalizeResult = (result: CallToolResult): CallToolResult => {
    if (validateOutput == null) {
      return result
    }
    if (result.structuredContent == null) {
      throw new ToolOutputValidationError(INTERNAL_ERROR, 'Invalid tool output', {
        issues: [{ message: 'Tool declares an outputSchema but returned no structuredContent' }],
      })
    }
    const validated = validateOutput(result.structuredContent)
    if (validated.issues != null) {
      throw new ToolOutputValidationError(INTERNAL_ERROR, 'Invalid tool output', {
        issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
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

  const wrappedHandler = async (
    request: HandlerRequest<{ arguments: Record<string, unknown> }>,
  ): Promise<CallToolResult> => {
    const validated = validateInput(request.arguments)
    if (validated.issues != null) {
      throw new RPCError(INVALID_PARAMS, 'Invalid tool input', {
        issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
      })
    }
    const result = await handler({
      arguments: validated.value,
      client: request.client,
      progress: request.progress,
      signal: request.signal,
    })
    return finalizeResult(result as CallToolResult)
  }

  const definition: GenericToolDefinition = {
    description,
    inputSchema: inputSchema as ToolInputSchema,
    handler: wrappedHandler,
  }
  if (outputSchema != null) {
    definition.outputSchema = outputSchema as ToolOutputSchema
  }
  return definition
}

export function toResourceHandlers(definitions: ResourceDefinitions): ResourceHandlers {
  const { list, listTemplates, read } = definitions
  return {
    list: typeof list === 'function' ? list : () => ({ resources: list ?? [] }),
    listTemplates:
      typeof listTemplates === 'function'
        ? listTemplates
        : () => ({ resourceTemplates: listTemplates ?? [] }),
    read,
  }
}
