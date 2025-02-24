import { type Schema, type Validator, createValidator } from '@enkaku/schema'
import { type CallToolRequest, type GetPromptRequest, clientMessage } from '@mokei/context-protocol'

export const validateClientMessage = createValidator(clientMessage)

export function toRequestParamsSchema(record: Record<string, Schema | undefined>): Array<Schema> {
  return Object.entries(record).map(([name, argumentsSchema]) => {
    return argumentsSchema
      ? ({
          type: 'object',
          required: ['name', 'arguments'],
          properties: {
            name: { type: 'string', const: name },
            arguments: argumentsSchema,
          },
        } as const satisfies Schema)
      : ({
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', const: name },
          },
        } as const satisfies Schema)
  }) as Array<Schema>
}

export function createCallToolsValidator(
  callTools: Record<string, Schema>,
): Validator<CallToolRequest> {
  const params = toRequestParamsSchema(callTools)
  const schema = {
    type: 'object',
    properties: {
      method: { type: 'string', const: 'tools/call' },
      params: params.length === 1 ? params[0] : { anyOf: params },
    },
    required: ['method', 'params'],
  } as const satisfies Schema
  return createValidator(schema)
}

export function createGetPromptsValidator(
  promptArguments: Record<string, Schema | undefined>,
): Validator<GetPromptRequest> {
  const params = toRequestParamsSchema(promptArguments)
  const schema = {
    type: 'object',
    properties: {
      method: { type: 'string', const: 'prompts/get' },
      params: params.length === 1 ? params[0] : { anyOf: params },
    },
    required: ['method', 'params'],
  } as const satisfies Schema
  return createValidator(schema)
}
