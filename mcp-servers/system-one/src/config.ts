import {
  createTool,
  type ExtractServerTypes,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
} from '@mokei/context-server'
import {
  createSystemOneClient,
  type QuestionMap,
  questionMapSchema,
  type State,
  SYSTEM_ONE_ERROR_META,
  type SystemOneClient,
  SystemOneError,
  stateSchema,
  systemOneErrorInfo,
} from '@mokei/system-one-client'

export type SystemOneToolsOptions = {
  client?: SystemOneClient
  url?: string
  apiKey?: string
  defaultModel?: string
}

const questionsInputSchema = {
  ...questionMapSchema,
  description: 'A System One question map: each key maps to a choice/score/noul question',
} as const satisfies Schema

export const predictOutputSchema = {
  type: 'object',
  properties: {
    model: { type: 'string' },
    answers: {
      type: 'object',
      additionalProperties: { type: 'object', additionalProperties: true },
    },
    usage: {
      type: 'object',
      properties: { inputTokens: { type: 'number' }, outputTokens: { type: 'number' } },
      required: ['inputTokens', 'outputTokens'],
      additionalProperties: false,
    },
    extras: { type: 'object', additionalProperties: true },
  },
  required: ['model', 'answers', 'usage'],
  additionalProperties: false,
} as const satisfies Schema

const env = (v?: string): string | undefined => (v != null && v !== '' ? v : undefined)

function resolveClient(options: SystemOneToolsOptions): SystemOneClient {
  return (
    options.client ??
    createSystemOneClient({
      url: options.url ?? env(process.env.SYSTEM_ONE_URL) ?? 'http://localhost:8000',
      apiKey: options.apiKey ?? env(process.env.SYSTEM_ONE_API_KEY),
      defaultModel: options.defaultModel ?? env(process.env.SYSTEM_ONE_MODEL),
    })
  )
}

export function createSystemOneTools(options: SystemOneToolsOptions = {}) {
  const client = resolveClient(options)

  return {
    predict: createTool({
      description: 'Classify text with System One typed questions (choice/score/noul)',
      inputSchema: {
        type: 'object',
        properties: {
          state: stateSchema,
          questions: questionsInputSchema,
          model: {
            type: 'string',
            description:
              'Optional model name; overrides SYSTEM_ONE_MODEL. The backend picks its default when omitted.',
          },
        },
        required: ['state', 'questions'],
        additionalProperties: false,
      } as const satisfies Schema,
      outputSchema: predictOutputSchema,
      handler: async (req) => {
        try {
          const result = await client.predict({
            state: req.input.state as State,
            questions: req.input.questions as QuestionMap,
            model: req.input.model as string | undefined,
            signal: req.signal,
          })
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: false,
          }
        } catch (err) {
          if (req.signal?.aborted) {
            throw err
          }
          return {
            isError: true,
            structuredContent: undefined,
            content: [{ type: 'text', text: err instanceof Error ? err.message : 'Unknown error' }],
            _meta: {
              [SYSTEM_ONE_ERROR_META]:
                err instanceof SystemOneError
                  ? systemOneErrorInfo(err)
                  : { name: 'SystemOneError' },
            },
          }
        }
      },
    }),
  } satisfies ToolDefinitions
}

export function createSystemOneConfig(options: SystemOneToolsOptions = {}) {
  return {
    name: 'system-one',
    version: '0.13.0',
    protocolVersions: ['2026-07-28', '2025-11-25'],
    tools: createSystemOneTools(options),
  } as const satisfies ServerConfig
}

export type SystemOneServerTypes = ExtractServerTypes<ReturnType<typeof createSystemOneConfig>>
