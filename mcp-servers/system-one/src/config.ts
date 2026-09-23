import {
  createTool,
  type ExtractServerTypes,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
} from '@mokei/context-server'
import {
  createSystemOneClient,
  guardQuestions,
  moderationQuestions,
  type QuestionMap,
  questionMapSchema,
  routerQuestions,
  type State,
  type SystemOneClient,
  stateSchema,
  triageQuestions,
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

  function presetTool(description: string, questions: QuestionMap) {
    return createTool({
      description,
      inputSchema: {
        type: 'object',
        properties: { state: stateSchema, model: { type: 'string' } },
        required: ['state'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: async (req) => {
        try {
          const result = await client.predict({
            state: req.input.state as State,
            questions,
            model: req.input.model as string | undefined,
            signal: req.signal,
          })
          return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
        } catch (err) {
          if (req.signal?.aborted) {
            throw err
          }
          return {
            content: [{ type: 'text', text: (err as Error).message ?? 'Unknown error' }],
            isError: true,
          }
        }
      },
    })
  }

  return {
    predict: createTool({
      description: 'Classify text with System One typed questions (choice/score/noul)',
      inputSchema: {
        type: 'object',
        properties: {
          state: stateSchema,
          questions: questionsInputSchema,
          model: { type: 'string', description: 'Model name; overrides SYSTEM_ONE_MODEL' },
        },
        required: ['state', 'questions'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: async (req) => {
        try {
          const result = await client.predict({
            state: req.input.state as State,
            questions: req.input.questions as QuestionMap,
            model: req.input.model as string | undefined,
            signal: req.signal,
          })
          return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
        } catch (err) {
          if (req.signal?.aborted) {
            throw err
          }
          return {
            content: [{ type: 'text', text: (err as Error).message ?? 'Unknown error' }],
            isError: true,
          }
        }
      },
    }),
    route: presetTool('Route to a model tier', routerQuestions()),
    guard: presetTool('Detect jailbreak / prompt-injection attempts', guardQuestions()),
    moderate: presetTool('Moderate content for safety', moderationQuestions()),
    triage: presetTool('Triage a support request', triageQuestions()),
  } satisfies ToolDefinitions
}

export function createSystemOneConfig(options: SystemOneToolsOptions = {}) {
  return {
    name: 'system-one',
    version: '0.13.1',
    protocolVersions: ['2026-07-28', '2025-11-25'],
    tools: createSystemOneTools(options),
  } as const satisfies ServerConfig
}

export type SystemOneServerTypes = ExtractServerTypes<ReturnType<typeof createSystemOneConfig>>
