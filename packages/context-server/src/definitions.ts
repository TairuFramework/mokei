import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  inferSchemaDraft,
  type CallToolResult,
  type InputSchema as ToolInputSchema,
  type OutputSchema as ToolOutputSchema,
} from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { createValidator, type FromSchema, type Schema } from '@sozai/schema'

import type {
  GenericPromptDefinition,
  GenericToolDefinition,
  HandlerRequest,
  PromptHandlerReturn,
  ResourceDefinitions,
  ResourceHandlers,
  ToolHandlerReturn,
  TypedPromptHandler,
  TypedToolHandler,
} from './types.js'

export function createPrompt<
  ArgumentsSchema extends Schema,
  Arguments = FromSchema<ArgumentsSchema>,
>(
  description: string,
  argumentsSchema: ArgumentsSchema,
  handler: TypedPromptHandler<Arguments>,
): GenericPromptDefinition {
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
> = {
  description: string
  inputSchema: InputSchema
  outputSchema?: OutputSchema
  handler: any
}

export function createTool<InputSchema extends Schema, OutputSchema extends Schema | undefined = undefined>(params: CreateToolParams<InputSchema, OutputSchema> | string, inputSchema?: InputSchema, handler?: any): GenericToolDefinition {
  let description: string
  let inputSch: InputSchema
  let handlerFn: any
  let outputSchema: Schema | undefined

  // Support both calling conventions
  if (typeof params === "string") {
    description = params
    inputSch = inputSchema!
    handlerFn = handler
    outputSchema = undefined
  } else {
    description = params.description
    inputSch = params.inputSchema
    handlerFn = params.handler
    outputSchema = params.outputSchema
  }

  const validateInput = createValidator<InputSchema, FromSchema<InputSchema>>(inputSch!, {
    draft: inferSchemaDraft(inputSch!),
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
      throw new RPCError(INTERNAL_ERROR, 'Invalid tool output', {
        issues: [{ message: 'Tool declares an outputSchema but returned no structuredContent' }],
      })
    }
    const validated = validateOutput(result.structuredContent)
    if (validated.issues != null) {
      throw new RPCError(INTERNAL_ERROR, 'Invalid tool output', {
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
    const validated_args = (validated as any).value
    const handlerResult = (handlerFn as any)({
      arguments: validated_args,
      client: request.client,
      progress: request.progress,
      signal: request.signal,
    })
    return finalizeResult(handlerResult as CallToolResult)
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
