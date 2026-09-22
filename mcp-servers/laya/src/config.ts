import {
  createTool,
  type ExtractServerTypes,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
} from '@mokei/context-server'
import {
  createLayaClient,
  guardQuestions,
  type LayaClient,
  moderationQuestions,
  type QuestionMap,
  questionSchema,
  routerQuestions,
  type State,
  stateSchema,
  triageQuestions,
} from '@mokei/laya-client'

export type LayaToolsOptions = {
  client?: LayaClient
  url?: string
  apiKey?: string
  defaultModel?: string
}

const questionsInputSchema = {
  type: 'object',
  additionalProperties: questionSchema,
  minProperties: 1,
  description: 'A Laya question map: each key maps to a choice/score/noul question',
} as const satisfies Schema

function resolveClient(options: LayaToolsOptions): LayaClient {
  return (
    options.client ??
    createLayaClient({
      url: options.url ?? process.env.LAYA_URL ?? 'http://localhost:8000',
      apiKey: options.apiKey ?? process.env.LAYA_API_KEY,
      defaultModel: options.defaultModel ?? process.env.LAYA_MODEL,
    })
  )
}

export function createLayaTools(options: LayaToolsOptions = {}) {
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
      description: 'Classify text with Laya typed questions (choice/score/noul)',
      inputSchema: {
        type: 'object',
        properties: {
          state: stateSchema,
          questions: questionsInputSchema,
          model: { type: 'string', description: 'Model name; overrides LAYA_MODEL' },
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

export function createLayaConfig(options: LayaToolsOptions = {}) {
  return {
    name: 'laya',
    version: '0.1.0',
    protocolVersions: ['2026-07-28', '2025-11-25'],
    tools: createLayaTools(options),
  } as const satisfies ServerConfig
}

export type LayaServerTypes = ExtractServerTypes<ReturnType<typeof createLayaConfig>>
