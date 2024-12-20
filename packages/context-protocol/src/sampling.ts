import type { Schema } from '@enkaku/schema'

import { imageContent, role, textContent } from './content.js'
import { request, result } from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1105
export const modelHint = {
  description: `Hints to use for model selection.
    
    Keys not declared here are currently left unspecified by the spec and are up to the client to interpret.`,
  properties: {
    name: {
      description: `A hint for a model name.
      
      The client SHOULD treat this as a substring of a model name; for example:
       - "claude-3-5-sonnet" should match "claude-3-5-sonnet-20241022"
       - "sonnet" should match "claude-3-5-sonnet-20241022", "claude-3-sonnet-20240229", etc.
       - "claude" should match any Claude model
       
      The client MAY also map the string to a different provider's model name or a different model family, as long as it fills a similar niche; for example:
       - "gemini-1.5-flash" could match "claude-3-haiku-20240307"`,
      type: 'string',
    },
  },
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1115
export const modelPreferences = {
  description: `The server's preferences for model selection, requested of the client during sampling.
    
    Because LLMs can vary along multiple dimensions, choosing the "best" model is rarely straightforward.  Different models excel in different areas—some are faster but less capable, others are more capable but more expensive, and so on. This interface allows servers to express their priorities across multiple dimensions to help clients make an appropriate selection for their use case.
    
    These preferences are always advisory. The client MAY ignore them. It is also up to the client to decide how to interpret these preferences and how to balance them against other considerations.`,
  properties: {
    costPriority: {
      description:
        'How much to prioritize cost when selecting a model. A value of 0 means cost is not important, while a value of 1 means cost is the most important factor.',
      maximum: 1,
      minimum: 0,
      type: 'number',
    },
    hints: {
      description: `Optional hints to use for model selection.
        
        If multiple hints are specified, the client MUST evaluate them in order (such that the first match is taken).
        
        The client SHOULD prioritize these hints over the numeric priorities, but MAY still use the priorities to select from ambiguous matches.`,
      items: modelHint,
      type: 'array',
    },
    intelligencePriority: {
      description:
        'How much to prioritize intelligence and capabilities when selecting a model. A value of 0 means intelligence is not important, while a value of 1 means intelligence is the most important factor.',
      maximum: 1,
      minimum: 0,
      type: 'number',
    },
    speedPriority: {
      description:
        'How much to prioritize sampling speed (latency) when selecting a model. A value of 0 means speed is not important, while a value of 1 means speed is the most important factor.',
      maximum: 1,
      minimum: 0,
      type: 'number',
    },
  },
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1711
export const samplingMessage = {
  description: 'Describes a message issued to or received from an LLM API.',
  properties: {
    content: {
      anyOf: [textContent, imageContent],
    },
    role,
  },
  required: ['content', 'role'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L332
export const createMessageRequest = {
  description:
    'A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'sampling/createMessage',
          type: 'string',
        },
        params: {
          properties: {
            includeContext: {
              description:
                'A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.',
              enum: ['allServers', 'none', 'thisServer'],
              type: 'string',
            },
            maxTokens: {
              description:
                'The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.',
              type: 'integer',
            },
            messages: {
              items: samplingMessage,
              type: 'array',
            },
            metadata: {
              additionalProperties: true,
              description:
                'Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.',
              properties: {},
              type: 'object',
            },
            modelPreferences,
            stopSequences: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            systemPrompt: {
              description:
                'An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.',
              type: 'string',
            },
            temperature: {
              type: 'number',
            },
          },
          required: ['maxTokens', 'messages'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L397
export const createMessageResult = {
  description:
    "The client's response to a sampling/create_message request from the server. The client should inform the user before returning the sampled message, to allow them to inspect the response (human in the loop) and decide whether to allow the server to see it.",
  allOf: [
    result,
    {
      properties: {
        content: {
          anyOf: [textContent, imageContent],
        },
        model: {
          description: 'The name of the model that generated the message.',
          type: 'string',
        },
        role,
        stopReason: {
          description: 'The reason why sampling stopped, if known.',
          type: 'string',
        },
      },
      required: ['content', 'model', 'role'],
      type: 'object',
    },
  ],
} as const satisfies Schema
