import { type FromSchema, type Schema, createValidator } from '@enkaku/schema'
import { INVALID_PARAMS, type InputSchema as ToolInputSchema } from '@mokei/context-protocol'

import { RPCError } from './error.js'
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
  const validate = createValidator<ArgumentsSchema, Arguments>(argumentsSchema)

  const wrappedHandler = (request: HandlerRequest<{ arguments: unknown }>): PromptHandlerReturn => {
    const validated = validate(request.arguments)
    if (validated.issues == null) {
      return handler({ arguments: validated.value, signal: request.signal })
    }
    throw new RPCError(INVALID_PARAMS, 'Invalid prompt arguments', {
      issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return { description, argumentsSchema, handler: wrappedHandler }
}

export function createTool<InputSchema extends Schema, Input = FromSchema<InputSchema>>(
  description: string,
  inputSchema: InputSchema,
  handler: TypedToolHandler<Input>,
): GenericToolDefinition {
  const validate = createValidator<InputSchema, Input>(inputSchema)

  const wrappedHandler = (
    request: HandlerRequest<{ input: Record<string, unknown> }>,
  ): ToolHandlerReturn => {
    const validated = validate(request.input)
    if (validated.issues == null) {
      return handler({ input: validated.value, signal: request.signal })
    }
    throw new RPCError(INVALID_PARAMS, 'Invalid tool input', {
      issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return { description, inputSchema: inputSchema as ToolInputSchema, handler: wrappedHandler }
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
