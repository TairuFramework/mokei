import type { ElicitRequest, ElicitResult } from '@mokei/context-protocol'
import { createTool, inputRequired, type ServerConfig } from '@mokei/context-server'

export const ELICITATION_TOOL_NAME = 'ask'
export const ELICITATION_PARAMS: ElicitRequest['params'] = {
  message: 'Please provide a value',
  requestedSchema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
  },
}
const STATE = { asked: true }
const STATE_STRING = JSON.stringify(STATE)

export function create2025ElicitationConfig(clientCapabilities: () => unknown): ServerConfig {
  return {
    name: 'session-elicitation-2025',
    version: '1.0.0',
    protocolVersions: ['2025-11-25'],
    tools: {
      [ELICITATION_TOOL_NAME]: createTool({
        description: 'Ask the client for a value',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async ({ client }) => {
          try {
            const response = await client.elicit(ELICITATION_PARAMS)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ clientCapabilities: clientCapabilities(), response }),
                },
              ],
            }
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    clientCapabilities: clientCapabilities(),
                    error: String(error),
                  }),
                },
              ],
            }
          }
        },
      }),
    },
  }
}

export function create2026ElicitationConfig(
  onRetry?: (response: ElicitResult) => void,
): ServerConfig {
  return {
    name: 'session-elicitation-2026',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    tools: {
      [ELICITATION_TOOL_NAME]: createTool({
        description: 'Ask the client for a value',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: ({ inputResponses, mintRequestState, requestState }) => {
          const response = inputResponses?.ask as ElicitResult | undefined
          if (response == null) {
            return inputRequired({
              inputRequests: { ask: { method: 'elicitation/create', params: ELICITATION_PARAMS } },
              requestState: mintRequestState(STATE),
            })
          }
          onRetry?.(response)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ response, requestState, expectedState: STATE_STRING }),
              },
            ],
          }
        },
      }),
    },
  }
}
