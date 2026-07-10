import {
  type CallToolResult,
  INVALID_PARAMS,
  inferSchemaDraft,
  type InputSchema as ToolInputSchema,
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

export type CreateToolParams<InputSchema extends Schema, Arguments = FromSchema<InputSchema>> = {
  description: string
  inputSchema: InputSchema
  handler: TypedToolHandler<Arguments>
}

export function createTool<InputSchema extends Schema, Arguments = FromSchema<InputSchema>>(
  params: CreateToolParams<InputSchema, Arguments>,
): GenericToolDefinition {
  const { description, inputSchema, handler } = params

  const validate = createValidator<InputSchema, Arguments>(inputSchema, {
    draft: inferSchemaDraft(inputSchema),
    strict: false,
  })

  const wrappedHandler = async (
    request: HandlerRequest<{ arguments: Record<string, unknown> }>,
  ): Promise<CallToolResult> => {
    const validated = validate(request.arguments)
    if (validated.issues == null) {
      return handler({
        arguments: validated.value,
        client: request.client,
        progress: request.progress,
        signal: request.signal,
      })
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
